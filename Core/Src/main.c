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
static FDCAN_TxHeaderTypeDef Tx_header;

/* USER CODE BEGIN PV */
uint8_t Tx[64];
uint8_t Rx[64];

/* Live-expression probes. USB probes live under usbdiag. */
volatile uint32_t fdcan_rx_msg_count   = 0U;
volatile uint32_t fdcan_tx_msg_count   = 0U;
volatile uint32_t fdcan_tx_err_count   = 0U;
volatile uint32_t fdcan_rx_err_count   = 0U;
volatile uint32_t fdcan_notif_err_count = 0U;
volatile uint32_t fdcan_rx_last_id     = 0U;
volatile uint8_t  fdcan_rx_last_len    = 0U;
volatile uint8_t  fdcan_rx_pending     = 0U;

static FDCAN_RxHeaderTypeDef LastRxHeader;
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
    case FDCAN_DLC_BYTES_0:  return 0U;
    case FDCAN_DLC_BYTES_1:  return 1U;
    case FDCAN_DLC_BYTES_2:  return 2U;
    case FDCAN_DLC_BYTES_3:  return 3U;
    case FDCAN_DLC_BYTES_4:  return 4U;
    case FDCAN_DLC_BYTES_5:  return 5U;
    case FDCAN_DLC_BYTES_6:  return 6U;
    case FDCAN_DLC_BYTES_7:  return 7U;
    case FDCAN_DLC_BYTES_8:  return 8U;
    case FDCAN_DLC_BYTES_12: return 12U;
    case FDCAN_DLC_BYTES_16: return 16U;
    case FDCAN_DLC_BYTES_20: return 20U;
    case FDCAN_DLC_BYTES_24: return 24U;
    case FDCAN_DLC_BYTES_32: return 32U;
    case FDCAN_DLC_BYTES_48: return 48U;
    case FDCAN_DLC_BYTES_64: return 64U;
    default:                 return 0U;
  }
}

static void CAN_Frame_To_USB(const FDCAN_RxHeaderTypeDef *hdr, const uint8_t *data)
{
  char buf[512];
  int n = 0;

  if (!USB_Driver_IsConfigured()) {
    return;
  }

  uint8_t len = FDCAN_DlcToBytes(hdr->DataLength);
  if (len > sizeof(Rx)) {
    len = (uint8_t)sizeof(Rx);
  }

  /* SDU frames are 0x100+boardId (fast) and 0x200+boardId (slow). Each board
   * gets its own pair of display lines so the two streams don't overwrite each
   * other on the terminal. */
  uint32_t id = hdr->Identifier;
  uint32_t base = id & 0xF00U;
  uint32_t board = id & 0x00FU;
  const uint32_t MAX_BOARD_ID = 1U; /* bump this if more SDUs join the bus */

  if ((base == 0x100U || base == 0x200U) && board <= MAX_BOARD_ID && len >= 64) {
    uint16_t time_ms = data[0] | (data[1] << 8);
    int16_t vals[15];
    for (int i = 0; i < 15; i++) {
      vals[i] = (int16_t)(data[2 + i*4] | (data[3 + i*4] << 8));
    }

    /* Lines: board 0 fast=1, board 0 slow=2, board 1 fast=3, board 1 slow=4 ... */
    int line = (int)(board * 2U + (base == 0x200U ? 2U : 1U));

    if (base == 0x100U) {
      int16_t shock = vals[6];
      n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                    "\033[%d;1H\033[K[B%lu ID %03lX Fast] dT:%ums | SG[mV]: %d, %d, %d, %d, %d, %d | Shock: %d.%02d mm\r\n",
                    line,
                    (unsigned long)board, (unsigned long)id,
                    time_ms,
                    vals[0], vals[1], vals[2], vals[3], vals[4], vals[5],
                    shock / 100, (shock > 0 ? shock : -shock) % 100);
    } else {
      int16_t rpm = vals[0];
      int16_t maxT = vals[1];
      int16_t minT = vals[2];
      int16_t ctrT = vals[3];
      int16_t tAmb = vals[4];
      int16_t brk  = vals[5];
      int16_t bAmb = vals[6];
      n += snprintf(buf + n, sizeof(buf) - (size_t)n,
                    "\033[%d;1H\033[K[B%lu ID %03lX Slow] dT:%ums | RPM: %d | Tire[Max:%d.%d Min:%d.%d Ctr:%d.%d Amb:%d.%d] Brk:%d.%d Amb:%d.%d\r\n",
                    line,
                    (unsigned long)board, (unsigned long)id,
                    time_ms, rpm,
                    maxT/10, (maxT>0?maxT:-maxT)%10,
                    minT/10, (minT>0?minT:-minT)%10,
                    ctrT/10, (ctrT>0?ctrT:-ctrT)%10,
                    tAmb/10, (tAmb>0?tAmb:-tAmb)%10,
                    brk/10, (brk>0?brk:-brk)%10,
                    bAmb/10, (bAmb>0?bAmb:-bAmb)%10);
    }
  } else {
    // Fallback to standard SLCAN
    if (hdr->IdType == FDCAN_STANDARD_ID) {
      n += snprintf(buf + n, sizeof(buf) - (size_t)n, "t%03lX%u",
                    (unsigned long)hdr->Identifier, (unsigned)len);
    } else {
      n += snprintf(buf + n, sizeof(buf) - (size_t)n, "T%08lX%u",
                    (unsigned long)hdr->Identifier, (unsigned)len);
    }
    for (uint8_t i = 0U; i < len; i++) {
      n += snprintf(buf + n, sizeof(buf) - (size_t)n, "%02X", data[i]);
    }
    if (n < (int)sizeof(buf) - 2) {
      buf[n++] = '\r';
      buf[n++] = '\n';
    }
  }

  if (n > (int)sizeof(buf)) {
    n = (int)sizeof(buf);
  }

  uint8_t usb_status;
  uint32_t timeout = 100000;
  do {
    usb_status = CDC_Transmit_FS((uint8_t *)buf, (uint16_t)n);
    if (usb_status == USBD_BUSY) {
      timeout--;
    }
  } while (usb_status == USBD_BUSY && timeout > 0);

  if (usb_status != USBD_OK) {
    usbdiag.tx_drop_count++;
  }
}
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
  MX_FDCAN1_Init();
  MX_ICACHE_Init();
  USB_Driver_Init();
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

  if (FDCAN_App_Init() != HAL_OK) {
    Error_Handler();
  }


  if (HAL_FDCAN_Start(&hfdcan1) != HAL_OK) {
    Error_Handler();
  }
  if (HAL_FDCAN_ActivateNotification(&hfdcan1, FDCAN_IT_RX_FIFO0_NEW_MESSAGE,
                                     0) != HAL_OK) {
    Error_Handler();
  }
  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  while (1) {
#if FDCAN_SELF_TEST_MODE
    for (int i = 0; i < 12; i++) {
      Tx[i]++;
    }

    if (HAL_FDCAN_AddMessageToTxFifoQ(&hfdcan1, &Tx_header, Tx) != HAL_OK) {
      fdcan_tx_err_count++;
    } else {
      fdcan_tx_msg_count++;
    }
#endif

    if (USB_Driver_IsConfigured()) {
      usbdiag.configured_seen_count++;
    }

    if (fdcan_rx_pending) {
      __disable_irq();
      FDCAN_RxHeaderTypeDef local_hdr = LastRxHeader;
      uint8_t local_rx[64];
      memcpy(local_rx, Rx, sizeof(Rx));
      fdcan_rx_pending = 0U;
      __enable_irq();

      CAN_Frame_To_USB(&local_hdr, local_rx);
    }

    HAL_Delay(10);
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
  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSI|RCC_OSCILLATORTYPE_HSI48
                              |RCC_OSCILLATORTYPE_LSE|RCC_OSCILLATORTYPE_MSI;
  RCC_OscInitStruct.LSEState = RCC_LSE_ON;
  RCC_OscInitStruct.HSIState = RCC_HSI_ON;
  RCC_OscInitStruct.HSICalibrationValue = RCC_HSICALIBRATION_DEFAULT;
  RCC_OscInitStruct.HSI48State = RCC_HSI48_ON;
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
  RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK|RCC_CLOCKTYPE_SYSCLK
                              |RCC_CLOCKTYPE_PCLK1|RCC_CLOCKTYPE_PCLK2;
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
void HAL_FDCAN_RxFifo0Callback(FDCAN_HandleTypeDef *hfdcan,
                               uint32_t RxFifo0ITs)
{
  if ((RxFifo0ITs & FDCAN_IT_RX_FIFO0_NEW_MESSAGE) != RESET)
  {
    if (HAL_FDCAN_GetRxMessage(hfdcan, FDCAN_RX_FIFO0, &LastRxHeader, Rx) != HAL_OK)
    {
      fdcan_rx_err_count++;
    }
    else
    {
      fdcan_rx_msg_count++;
      fdcan_rx_last_id  = LastRxHeader.Identifier;
      fdcan_rx_last_len = FDCAN_DlcToBytes(LastRxHeader.DataLength);
      fdcan_rx_pending  = 1U;
    }
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
  while (1) {
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
