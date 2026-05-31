/* USER CODE BEGIN Header */
/**
 ******************************************************************************
 * @file           : main.c
 * @brief          : Main program body
 ******************************************************************************
 * @attention
 *
 * Copyright (c) 2026 STMicroelectronics.
 * All rights reserved.
 *
 * This software is licensed under terms that can be found in the LICENSE file
 * in the root directory of this software component.
 * If no LICENSE file comes with this software, it is provided AS-IS.
 *
 ******************************************************************************
 */
/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include "main.h"
#include "fdcan.h"
#include "icache.h"
#include "usb_device.h"
#include "gpio.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include "../../Drivers/BFR_Krill_Drivers/Inc/usb_driver.h"
#include "usbd_conf.h"
#include "usbd_cdc_if.h"
#include "can.h"
#include <stdio.h>
#include <string.h>
/* USER CODE END Includes */

/* Private typedef -----------------------------------------------------------*/
/* USER CODE BEGIN PTD */

/* USER CODE END PTD */

/* Private define ------------------------------------------------------------*/
/* USER CODE BEGIN PD */
#define FDCAN_SELF_TEST_MODE 0U

/* USER CODE END PD */

/* Private macro -------------------------------------------------------------*/
/* USER CODE BEGIN PM */

/* USER CODE END PM */

/* Private variables ---------------------------------------------------------*/

/* USER CODE BEGIN PV */
static FDCAN_TxHeaderTypeDef Tx_header;
uint8_t Tx[64];
uint8_t Rx[64];

/* Live-expression probes. USB probes live under usbdiag. */
volatile uint32_t fdcan_rx_msg_count = 0U;
volatile uint32_t fdcan_tx_msg_count = 0U;
volatile uint32_t fdcan_tx_err_count = 0U;
volatile uint32_t fdcan_rx_err_count = 0U;
volatile uint32_t fdcan_notif_err_count = 0U;
volatile uint32_t fdcan_rx_last_id = 0U;
volatile uint8_t fdcan_rx_last_len = 0U;
volatile uint8_t fdcan_rx_pending = 0U;

extern USBD_HandleTypeDef hUsbDeviceFS;
//
// #define FDCAN_RX_QUEUE_SIZE 16
typedef struct
{
  FDCAN_RxHeaderTypeDef header;
  uint8_t data[64];
} FDCAN_RxFrame_t;

static FDCAN_RxFrame_t fdcan_rx_queue[FDCAN_RX_QUEUE_SIZE];
static volatile uint8_t fdcan_rx_head = 0;
static volatile uint8_t fdcan_rx_tail = 0;

#define USB_TX_RING_SIZE 4096
static uint8_t usb_tx_ring[USB_TX_RING_SIZE];
static volatile uint16_t usb_tx_head = 0;
static volatile uint16_t usb_tx_tail = 0;
/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
/* USER CODE BEGIN PFP */

/* USER CODE END PFP */

/* Private user code ---------------------------------------------------------*/
/* USER CODE BEGIN 0 */
static uint8_t FDCAN_DlcToBytes(uint32_t dlc)
{
  switch (dlc)
  {
  case FDCAN_DLC_BYTES_0:
    return 0U;
  case FDCAN_DLC_BYTES_1:
    return 1U;
  case FDCAN_DLC_BYTES_2:
    return 2U;
  case FDCAN_DLC_BYTES_3:
    return 3U;
  case FDCAN_DLC_BYTES_4:
    return 4U;
  case FDCAN_DLC_BYTES_5:
    return 5U;
  case FDCAN_DLC_BYTES_6:
    return 6U;
  case FDCAN_DLC_BYTES_7:
    return 7U;
  case FDCAN_DLC_BYTES_8:
    return 8U;
  case FDCAN_DLC_BYTES_12:
    return 12U;
  case FDCAN_DLC_BYTES_16:
    return 16U;
  case FDCAN_DLC_BYTES_20:
    return 20U;
  case FDCAN_DLC_BYTES_24:
    return 24U;
  case FDCAN_DLC_BYTES_32:
    return 32U;
  case FDCAN_DLC_BYTES_48:
    return 48U;
  case FDCAN_DLC_BYTES_64:
    return 64U;
  default:
    return 0U;
  }
}

static void usb_ring_push(const char *str, uint16_t len)
{
  uint16_t head = usb_tx_head;
  uint16_t tail = usb_tx_tail;

  // Calculate free space in ring buffer
  uint16_t free_space;
  if (head <= tail)
  {
    free_space = USB_TX_RING_SIZE - 1 - (tail - head);
  }
  else
  {
    free_space = head - tail - 1;
  }

  if (len > free_space)
  {
    usbdiag.tx_drop_count++;
    return;
  }

  for (uint16_t i = 0; i < len; i++)
  {
    usb_tx_ring[tail] = (uint8_t)str[i];
    tail = (tail + 1) % USB_TX_RING_SIZE;
  }

  usb_tx_tail = tail;
}

/* report shift-register pin test result once over USB CDC when configured */
volatile uint8_t sr_test_reported = 0;

/* 74HC595 shift-register driver (MSB-first) and simple LED API */
#define BAUD_UNKNOWN 0U
#define BAUD_500K 1U
#define BAUD_5M 2U
#define BAUD_1M 3U

volatile uint8_t g_detected_baud = BAUD_UNKNOWN;
/* Result bits: bit0=SER, bit1=SERCLK, bit2=RSTCLK (set if high when written) */
volatile uint8_t sr_pin_test_result = 0;

static void ShiftRegister_WriteByte(uint8_t data)
{
  for (int8_t i = 7; i >= 0; --i)
  {
    HAL_GPIO_WritePin(SER_GPIO_Port, SER_Pin, (data & (1U << i)) ? GPIO_PIN_SET : GPIO_PIN_RESET);
    HAL_GPIO_WritePin(SERCLK_GPIO_Port, SERCLK_Pin, GPIO_PIN_SET);
    __NOP();
    __NOP();
    HAL_GPIO_WritePin(SERCLK_GPIO_Port, SERCLK_Pin, GPIO_PIN_RESET);
  }

  /* Latch (RCLK) */
  HAL_GPIO_WritePin(RSTCLK_GPIO_Port, RSTCLK_Pin, GPIO_PIN_SET);
  __NOP();
  HAL_GPIO_WritePin(RSTCLK_GPIO_Port, RSTCLK_Pin, GPIO_PIN_RESET);
}

static void Update_BaudStatus_LEDs(uint8_t detected)
{
  uint8_t mask = 0x03U; /* default: both on = unknown */
  if (detected == BAUD_500K)
    mask = 0x01U;
  else if (detected == BAUD_1M)
    mask = 0x01U; /* same single-LED pattern as 500k */
  else if (detected == BAUD_5M)
    mask = 0x02U;
  ShiftRegister_WriteByte(mask);
}

/* Try two candidates in bus-monitoring (listen-only) then start normal.
 * Returns 0 on successful autodetect/start, -1 on fallback (no match).
 */
static int FDCAN_AutodetectAndStart(void)
{
  const uint32_t DETECT_MS = 250U;
  FDCAN_InitTypeDef original = hfdcan1.Init;
  FDCAN_InitTypeDef cand = original;
  FDCAN_ProtocolStatusTypeDef ps;

  /* Candidate: Classic frame — try common prescalers (1Mb and 500kb) */
  {
    const uint32_t prescalers[] = {5U, 10U}; /* 5 -> 1Mb, 10 -> 500kb (given same time segments) */
    const uint8_t baud_map[] = {BAUD_1M, BAUD_500K};
    for (size_t pi = 0; pi < (sizeof(prescalers) / sizeof(prescalers[0])); ++pi)
    {
      cand = original;
      cand.FrameFormat = FDCAN_FRAME_CLASSIC;
      cand.NominalPrescaler = prescalers[pi];

      if (FDCAN_ApplyInitAndStart(&cand, FDCAN_MODE_BUS_MONITORING) == HAL_OK)
      {
        HAL_FDCAN_ActivateNotification(&hfdcan1, FDCAN_IT_RX_FIFO0_NEW_MESSAGE, 0);
        uint32_t t0 = HAL_GetTick();
        uint32_t before = HAL_FDCAN_GetRxFifoFillLevel(&hfdcan1, FDCAN_RX_FIFO0);
        while ((HAL_GetTick() - t0) < DETECT_MS)
        {
          uint32_t now = HAL_FDCAN_GetRxFifoFillLevel(&hfdcan1, FDCAN_RX_FIFO0);
          if (now > before)
          {
            if (HAL_FDCAN_GetProtocolStatus(&hfdcan1, &ps) == HAL_OK)
            {
              if (!(ps.RxFDFflag || ps.RxBRSflag))
              {
                /* Classic CAN detected at this prescaler */
                cand.Mode = FDCAN_MODE_NORMAL;
                if (FDCAN_ApplyInitAndStart(&cand, FDCAN_MODE_NORMAL) == HAL_OK)
                {
                  g_detected_baud = baud_map[pi];
                  Update_BaudStatus_LEDs(g_detected_baud);
                  HAL_FDCAN_ActivateNotification(&hfdcan1, FDCAN_IT_RX_FIFO0_NEW_MESSAGE, 0);
                  return 0;
                }
              }
            }
            break;
          }
          HAL_Delay(10);
        }
      }
    }
  }

  /* Candidate: FD with BRS (5M data) — try both 1Mb and 500kb nominal prescalers */
  {
    const uint32_t prescalers[] = {5U, 10U}; /* 5 -> 1Mb nominal, 10 -> 500kb nominal */
    for (size_t pi = 0; pi < (sizeof(prescalers) / sizeof(prescalers[0])); ++pi)
    {
      cand = original;
      cand.FrameFormat = FDCAN_FRAME_FD_BRS;
      cand.NominalPrescaler = prescalers[pi];
      if (FDCAN_ApplyInitAndStart(&cand, FDCAN_MODE_BUS_MONITORING) == HAL_OK)
      {
        HAL_FDCAN_ActivateNotification(&hfdcan1, FDCAN_IT_RX_FIFO0_NEW_MESSAGE, 0);
        uint32_t t0 = HAL_GetTick();
        uint32_t before = HAL_FDCAN_GetRxFifoFillLevel(&hfdcan1, FDCAN_RX_FIFO0);
        while ((HAL_GetTick() - t0) < DETECT_MS)
        {
          uint32_t now = HAL_FDCAN_GetRxFifoFillLevel(&hfdcan1, FDCAN_RX_FIFO0);
          if (now > before)
          {
            /* Any frame observed in FD mode => assume FD with BRS */
            cand.Mode = FDCAN_MODE_NORMAL;
            if (FDCAN_ApplyInitAndStart(&cand, FDCAN_MODE_NORMAL) == HAL_OK)
            {
              g_detected_baud = BAUD_5M;
              Update_BaudStatus_LEDs(g_detected_baud);
              HAL_FDCAN_ActivateNotification(&hfdcan1, FDCAN_IT_RX_FIFO0_NEW_MESSAGE, 0);
              return 0;
            }
            break;
          }
          HAL_Delay(10);
        }
      }
    }
  }

  /* No candidate matched: restore original config and start normal
   * Indicate unknown by turning both LEDs on (mask 0x03).
   */
  if (FDCAN_ApplyInitAndStart(&original, FDCAN_MODE_NORMAL) == HAL_OK)
  {
    g_detected_baud = BAUD_UNKNOWN;
    Update_BaudStatus_LEDs(g_detected_baud);
    HAL_FDCAN_ActivateNotification(&hfdcan1, FDCAN_IT_RX_FIFO0_NEW_MESSAGE, 0);
    return -1;
  }

  return -1;
}

/* Quick pin self-test: write each pin high and read back input state. Sets
 * bits in `sr_pin_test_result` so user can inspect via debugger/usbdiag.
 */
static void ShiftRegister_PinSelfTest(void)
{
  sr_pin_test_result = 0;

  /* Test SER */
  HAL_GPIO_WritePin(SER_GPIO_Port, SER_Pin, GPIO_PIN_SET);
  HAL_Delay(1);
  if (HAL_GPIO_ReadPin(SER_GPIO_Port, SER_Pin) == GPIO_PIN_SET)
    sr_pin_test_result |= 0x01U;
  HAL_GPIO_WritePin(SER_GPIO_Port, SER_Pin, GPIO_PIN_RESET);

  /* Test SERCLK */
  HAL_GPIO_WritePin(SERCLK_GPIO_Port, SERCLK_Pin, GPIO_PIN_SET);
  HAL_Delay(1);
  if (HAL_GPIO_ReadPin(SERCLK_GPIO_Port, SERCLK_Pin) == GPIO_PIN_SET)
    sr_pin_test_result |= 0x02U;
  HAL_GPIO_WritePin(SERCLK_GPIO_Port, SERCLK_Pin, GPIO_PIN_RESET);

  /* Test RSTCLK */
  HAL_GPIO_WritePin(RSTCLK_GPIO_Port, RSTCLK_Pin, GPIO_PIN_SET);
  HAL_Delay(1);
  if (HAL_GPIO_ReadPin(RSTCLK_GPIO_Port, RSTCLK_Pin) == GPIO_PIN_SET)
    sr_pin_test_result |= 0x04U;
  HAL_GPIO_WritePin(RSTCLK_GPIO_Port, RSTCLK_Pin, GPIO_PIN_RESET);

  /* Try writing a visible pattern (0x03 = both LEDs on) */
  ShiftRegister_WriteByte(0x03U);
}

// static void CAN_Frame_To_USB(const FDCAN_RxHeaderTypeDef *hdr, const uint8_t *data)
//{
//   char buf[512];
//   int n = 0;
//
//   if (!USB_Driver_IsConfigured()) {
//     return;
//   }
//
//   uint8_t len = FDCAN_DlcToBytes(hdr->DataLength);
//   if (len > 64) {
//     len = 64;
//   }
//
//   uint32_t id = hdr->Identifier;
//   uint32_t base = id & 0xF00U;
//   uint32_t middle = id & 0x0F0U;
//   uint32_t board = id & 0x00FU;
//   const uint32_t MAX_BOARD_ID = 1U;
//
//   if ((base == 0x100U || base == 0x200U) && board <= MAX_BOARD_ID && len >= 64) {
//     if (middle == 0x00U) {
//       // Legacy format fallback parsing
//       uint16_t time_ms = data[0] | (data[1] << 8);
//       int16_t vals[15];
//       for (int i = 0; i < 15; i++) {
//         vals[i] = (int16_t)(data[2 + i*4] | (data[3 + i*4] << 8));
//       }
//
//       int line = (int)(board * 2U + (base == 0x200U ? 2U : 1U));
//
//       if (base == 0x100U) {
//         int16_t shock = vals[6];
//         n += snprintf(buf + n, sizeof(buf) - (size_t)n,
//                       "\033[%d;1H\033[K[B%lu ID %03lX Legacy Fast] dT:%ums | SG[mV]: %d, %d, %d, %d, %d, %d | Shock: %d.%02d mm\r\n",
//                       line, (unsigned long)board, (unsigned long)id, time_ms,
//                       vals[0], vals[1], vals[2], vals[3], vals[4], vals[5],
//                       shock / 100, (shock > 0 ? shock : -shock) % 100);
//       } else {
//         int16_t rpm = vals[0];
//         int16_t maxT = vals[1];
//         int16_t minT = vals[2];
//         int16_t ctrT = vals[3];
//         int16_t tAmb = vals[4];
//         int16_t brk  = vals[5];
//         int16_t bAmb = vals[6];
//         n += snprintf(buf + n, sizeof(buf) - (size_t)n,
//                       "\033[%d;1H\033[K[B%lu ID %03lX Legacy Slow] dT:%ums | RPM: %d | Tire[Max:%d.%d Min:%d.%d Ctr:%d.%d Amb:%d.%d] Brk:%d.%d Amb:%d.%d\r\n",
//                       line, (unsigned long)board, (unsigned long)id, time_ms, rpm,
//                       maxT/10, (maxT>0?maxT:-maxT)%10,
//                       minT/10, (minT>0?minT:-minT)%10,
//                       ctrT/10, (ctrT>0?ctrT:-ctrT)%10,
//                       tAmb/10, (tAmb>0?tAmb:-tAmb)%10,
//                       brk/10, (brk>0?brk:-brk)%10,
//                       bAmb/10, (bAmb>0?bAmb:-bAmb)%10);
//       }
//     } else {
//       // High-fidelity packed parsing
//       uint32_t base_time = data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
//       uint16_t err = data[4] | (data[5] << 8);
//
//       if (base == 0x100U && middle == 0x10U) {
//         // Strain Gauge Block
//         uint8_t ch1_upper = data[6];
//         uint8_t ch2_upper = data[7];
//         uint8_t ch1_ch2_lower = data[8];
//         uint8_t ch3_upper = data[9];
//         uint8_t ch4_upper = data[10];
//         uint8_t ch3_ch4_lower = data[11];
//         uint8_t ch5_upper = data[12];
//         uint8_t ch6_upper = data[13];
//         uint8_t ch5_ch6_lower = data[14];
//         int8_t jitter = (int8_t)data[15];
//
//         uint16_t vals[6];
//         vals[0] = (uint16_t)((ch1_upper << 4) | (ch1_ch2_lower >> 4));
//         vals[1] = (uint16_t)((ch2_upper << 4) | (ch1_ch2_lower & 0x0FU));
//         vals[2] = (uint16_t)((ch3_upper << 4) | (ch3_ch4_lower >> 4));
//         vals[3] = (uint16_t)((ch4_upper << 4) | (ch3_ch4_lower & 0x0FU));
//         vals[4] = (uint16_t)((ch5_upper << 4) | (ch5_ch6_lower >> 4));
//         vals[5] = (uint16_t)((ch6_upper << 4) | (ch5_ch6_lower & 0x0FU));
//
//         int sg_mv[6];
//         for (int i = 0; i < 6; i++) {
//           float v = ((float)vals[i] / 4095.0f) * 6.6f - 3.3f;
//           sg_mv[i] = (int)(v * 1000.0f);
//         }
//
//         int line = (int)(board * 5U + 1U);
//         n += snprintf(buf + n, sizeof(buf) - (size_t)n,
//                       "\033[%d;1H\033[K[B%lu SG ID %03lX] BaseUs:%lu | SG[mV]: %d, %d, %d, %d, %d, %d | Err:0x%04X | Jitter:%dus\r\n",
//                       line, (unsigned long)board, (unsigned long)id, (unsigned long)base_time,
//                       sg_mv[0], sg_mv[1], sg_mv[2], sg_mv[3], sg_mv[4], sg_mv[5],
//                       (unsigned)err, (int)jitter);
//
//       } else if (base == 0x100U && middle == 0x20U) {
//         // Shock Pot - FIXED: Reads samples[0] (bytes 6-8) instead of blank tail elements
//         uint16_t raw_val = data[6] | (data[7] << 8);
//         int8_t jitter = (int8_t)data[8];
//
//         int line = (int)(board * 5U + 2U);
//         n += snprintf(buf + n, sizeof(buf) - (size_t)n,
//                       "\033[%d;1H\033[K[B%lu Shock ID %03lX] BaseUs:%lu | Shock: %d.%02d mm | Err:0x%04X | Jitter:%dus\r\n",
//                       line, (unsigned long)board, (unsigned long)id, (unsigned long)base_time,
//                       raw_val / 100, raw_val % 100, (unsigned)err, (int)jitter * 4); // Multiplying by 4 to map back down from 4us/LSB format
//
//       } else if (base == 0x200U && middle == 0x10U) {
//         // Wheel Speed - FIXED: Reads samples[0] (bytes 6-8)
//         uint16_t raw_val = data[6] | (data[7] << 8);
//         int8_t jitter = (int8_t)data[8];
//
//         int line = (int)(board * 5U + 3U);
//         n += snprintf(buf + n, sizeof(buf) - (size_t)n,
//                       "\033[%d;1H\033[K[B%lu Wheel ID %03lX] BaseUs:%lu | RPM: %d.%d | Err:0x%04X | Jitter:%dus\r\n",
//                       line, (unsigned long)board, (unsigned long)id, (unsigned long)base_time,
//                       raw_val / 10, raw_val % 10, (unsigned)err, (int)jitter * 4);
//
//       } else if (base == 0x200U && middle == 0x20U) {
//         // Brake Temp - FIXED: Reads samples[0] (bytes 6-8)
//         uint16_t raw_val = data[6] | (data[7] << 8);
//         int8_t jitter = (int8_t)data[8];
//
//         int line = (int)(board * 5U + 4U);
//         n += snprintf(buf + n, sizeof(buf) - (size_t)n,
//                       "\033[%d;1H\033[K[B%lu Brake ID %03lX] BaseUs:%lu | Brake Temp: %d.%d C | Err:0x%04X | Jitter:%dus\r\n",
//                       line, (unsigned long)board, (unsigned long)id, (unsigned long)base_time,
//                       raw_val / 10, raw_val % 10, (unsigned)err, (int)jitter * 4);
//
//       } else if (base == 0x200U && middle == 0x30U) {
//         // Tire Temp Block - Grabs first accumulated history block metrics
//         uint8_t max_t = data[6];
//         uint8_t min_t = data[7];
//         int8_t jitter_ms = (int8_t)data[10];
//
//         int line = (int)(board * 5U + 5U);
//         n += snprintf(buf + n, sizeof(buf) - (size_t)n,
//                       "\033[%d;1H\033[K[B%lu Tire ID %03lX] BaseUs:%lu | Tire Max: %u C, Min: %u C | Err:0x%04X | Jitter:%dms\r\n",
//                       line, (unsigned long)board, (unsigned long)id, (unsigned long)base_time,
//                       max_t, min_t, (unsigned)err, (int)jitter_ms);
//       }
//     }
//   } else {
//     // Fallback standard SLCAN logging format
//     if (hdr->IdType == FDCAN_STANDARD_ID) {
//       n += snprintf(buf + n, sizeof(buf) - (size_t)n, "t%03lX%u", (unsigned long)hdr->Identifier, (unsigned)len);
//     } else {
//       n += snprintf(buf + n, sizeof(buf) - (size_t)n, "T%08lX%u", (unsigned long)hdr->Identifier, (unsigned)len);
//     }
//     for (uint8_t i = 0U; i < len; i++) {
//       n += snprintf(buf + n, sizeof(buf) - (size_t)n, "%02X", data[i]);
//     }
//     if (n < (int)sizeof(buf) - 2) {
//       buf[n++] = '\r';
//       buf[n++] = '\n';
//     }
//   }
//
//   if (n > (int)sizeof(buf)) n = (int)sizeof(buf);
//   usb_ring_push(buf, (uint16_t)n);
// }
/* USER CODE END 0 */

/**
 * @brief  The application entry point.
 * @retval int
 */
int main(void)
{

  /* USER CODE BEGIN 1 */

  /* USER CODE END 1 */

  /* MCU Configuration--------------------------------------------------------*/

  /* Reset of all peripherals, Initializes the Flash interface and the Systick. */
  HAL_Init();

  /* USER CODE BEGIN Init */

  /* USER CODE END Init */

  /* Configure the system clock */
  SystemClock_Config();

  /* USER CODE BEGIN SysInit */

  /* USER CODE END SysInit */

  /* Initialize all configured peripherals */
  MX_GPIO_Init();
  /* Run shift-register pin self-test immediately after GPIO init */
  ShiftRegister_PinSelfTest();
  MX_FDCAN1_Init();
  MX_ICACHE_Init();
  MX_USB_Device_Init();
  /* USER CODE BEGIN 2 */
  Tx_header.Identifier = 0x77;
  Tx_header.IdType = FDCAN_STANDARD_ID;
  Tx_header.TxFrameType = FDCAN_DATA_FRAME;
  Tx_header.DataLength = FDCAN_DLC_BYTES_12;
  Tx_header.ErrorStateIndicator = FDCAN_ESI_ACTIVE;
  Tx_header.BitRateSwitch = FDCAN_BRS_ON;
  Tx_header.FDFormat = FDCAN_FD_CAN;
  Tx_header.TxEventFifoControl = FDCAN_NO_TX_EVENTS;
  Tx_header.MessageMarker = 0;

  /* Autodetect bus settings (listen-only) and start FDCAN */
  if (FDCAN_AutodetectAndStart() != 0)
  {
    /* Fallback: ensure notifications are enabled on the current config */
    if (HAL_FDCAN_ActivateNotification(&hfdcan1, FDCAN_IT_RX_FIFO0_NEW_MESSAGE, 0) != HAL_OK)
    {
      Error_Handler();
    }
  }
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  /* --- IN KRILL MDU main.c background while(1) loop --- */
  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1)
  {
#if FDCAN_SELF_TEST_MODE
    for (int i = 0; i < 12; i++)
    {
      Tx[i]++;
    }
    if (HAL_FDCAN_AddMessageToTxFifoQ(&hfdcan1, &Tx_header, Tx) != HAL_OK)
    {
      fdcan_tx_err_count++;
    }
    else
    {
      fdcan_tx_msg_count++;
    }
#endif

    if (USB_Driver_IsConfigured())
    {
      usbdiag.configured_seen_count++;
      if (!sr_test_reported)
      {
        char buf[32];
        int n = snprintf(buf, sizeof(buf), "SR_TEST: 0x%02X\r\n", (unsigned)sr_pin_test_result);
        if (n > 0)
        {
          (void)CDC_Transmit_FS((uint8_t *)buf, (uint16_t)n);
        }
        sr_test_reported = 1;
      }
    }

    // Call the SLCAN converter directly
    CAN_To_USB_Process();

    /* USER CODE END WHILE */

    /* USER CODE BEGIN 3 */
  }
  /* USER CODE END 3 */
}

/**
 * @brief System Clock Configuration
 * @retval None
 */
void SystemClock_Config(void)
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

  /** Configure the main internal regulator output voltage
   */
  if (HAL_PWREx_ControlVoltageScaling(PWR_REGULATOR_VOLTAGE_SCALE0) != HAL_OK)
  {
    Error_Handler();
  }

  /** Configure LSE Drive Capability
   */
  HAL_PWR_EnableBkUpAccess();
  __HAL_RCC_LSEDRIVE_CONFIG(RCC_LSEDRIVE_LOW);

  /** Initializes the RCC Oscillators according to the specified parameters
   * in the RCC_OscInitTypeDef structure.
   */
  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSI | RCC_OSCILLATORTYPE_LSE | RCC_OSCILLATORTYPE_MSI;
  RCC_OscInitStruct.LSEState = RCC_LSE_ON;
  RCC_OscInitStruct.HSIState = RCC_HSI_ON;
  RCC_OscInitStruct.HSICalibrationValue = RCC_HSICALIBRATION_DEFAULT;
  RCC_OscInitStruct.MSIState = RCC_MSI_ON;
  RCC_OscInitStruct.MSICalibrationValue = RCC_MSICALIBRATION_DEFAULT;
  RCC_OscInitStruct.MSIClockRange = RCC_MSIRANGE_6;
  RCC_OscInitStruct.PLL.PLLState = RCC_PLL_ON;
  RCC_OscInitStruct.PLL.PLLSource = RCC_PLLSOURCE_HSI;
  RCC_OscInitStruct.PLL.PLLM = 4;
  RCC_OscInitStruct.PLL.PLLN = 55;
  RCC_OscInitStruct.PLL.PLLP = RCC_PLLP_DIV7;
  RCC_OscInitStruct.PLL.PLLQ = RCC_PLLQ_DIV2;
  RCC_OscInitStruct.PLL.PLLR = RCC_PLLR_DIV2;
  if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
  {
    Error_Handler();
  }

  /** Initializes the CPU, AHB and APB buses clocks
   */
  RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  RCC_ClkInitStruct.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
  RCC_ClkInitStruct.AHBCLKDivider = RCC_SYSCLK_DIV1;
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV1;
  RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV1;

  if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_5) != HAL_OK)
  {
    Error_Handler();
  }

  /** Enable MSI Auto calibration
   */
  HAL_RCCEx_EnableMSIPLLMode();
}

/* USER CODE BEGIN 4 */

// Wrapper implementations allowing can.c to safely reference the ring buffer memory
// Updated to use your exact codebase names (without s_ prefix)
uint8_t MDU_Get_Rx_Queue_State(uint8_t *head_out, uint8_t *tail_out)
{
  *head_out = fdcan_rx_head;
  *tail_out = fdcan_rx_tail;
  return (fdcan_rx_head != fdcan_rx_tail);
}

void MDU_Get_Rx_Queue_Data(uint8_t index, FDCAN_RxHeaderTypeDef *hdr_out, uint8_t *data_out)
{
  *hdr_out = fdcan_rx_queue[index].header;
  memcpy(data_out, fdcan_rx_queue[index].data, 64);
}

void MDU_Advance_Rx_Queue_Head(void)
{
  __disable_irq();
  // Uses the official FDCAN_RX_QUEUE_SIZE from fdcan.h (8U)
  fdcan_rx_head = (fdcan_rx_head + 1) % FDCAN_RX_QUEUE_SIZE;
  __enable_irq();
}

void HAL_FDCAN_RxFifo0Callback(FDCAN_HandleTypeDef *hfdcan, uint32_t RxFifo0ITs)
{
  if ((RxFifo0ITs & FDCAN_IT_RX_FIFO0_NEW_MESSAGE) != RESET)
  {
    FDCAN_RxHeaderTypeDef temp_hdr;
    uint8_t temp_data[64];

    // Safely pull messages from the hardware registers into intermediate structures
    while (HAL_FDCAN_GetRxMessage(hfdcan, FDCAN_RX_FIFO0, &temp_hdr, temp_data) == HAL_OK)
    {
      fdcan_rx_msg_count++;
      fdcan_rx_last_id = temp_hdr.Identifier;
      fdcan_rx_last_len = FDCAN_DlcToBytes(temp_hdr.DataLength);

      // Thread-safe Ring advancement write strategy
      uint8_t current_tail = fdcan_rx_tail;
      uint8_t next_tail = (current_tail + 1) % FDCAN_RX_QUEUE_SIZE;

      // If the queue isn't full, push raw hardware frames into software buffer memory
      if (next_tail != fdcan_rx_head)
      {
        fdcan_rx_queue[current_tail].header = temp_hdr;
        memcpy(fdcan_rx_queue[current_tail].data, temp_data, 64);
        fdcan_rx_tail = next_tail;
      }
      else
      {
        fdcan_rx_err_count++; // Track soft-drop overruns
      }
    }

    // Reactivate the interrupt configuration flag mapping
    if (HAL_FDCAN_ActivateNotification(hfdcan, FDCAN_IT_RX_FIFO0_NEW_MESSAGE, 0) != HAL_OK)
    {
      fdcan_notif_err_count++;
    }
  }
}
/* USER CODE END 4 */

/**
 * @brief  This function is executed in case of error occurrence.
 * @retval None
 */
void Error_Handler(void)
{
  /* USER CODE BEGIN Error_Handler_Debug */
  /* User can add his own implementation to report the HAL error return state */
  __disable_irq();
  while (1)
  {
  }
  /* USER CODE END Error_Handler_Debug */
}
#ifdef USE_FULL_ASSERT
/**
 * @brief  Reports the name of the source file and the source line number
 *         where the assert_param error has occurred.
 * @param  file: pointer to the source file name
 * @param  line: assert_param error line source number
 * @retval None
 */
void assert_failed(uint8_t *file, uint32_t line)
{
  /* USER CODE BEGIN 6 */
  /* User can add his own implementation to report the file name and line
     number, ex: printf("Wrong parameters value: file %s on line %d\r\n", file,
     line) */
  /* USER CODE END 6 */
}
#endif /* USE_FULL_ASSERT */
