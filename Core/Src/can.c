#include "can.h"
#include "fdcan.h"
#include "usb_device.h"
#include "usbd_cdc_if.h"
#include <stdio.h>
#include <string.h>

extern uint8_t MDU_Get_Rx_Queue_State(uint8_t *head_out, uint8_t *tail_out);
extern void MDU_Get_Rx_Queue_Data(uint8_t index, FDCAN_RxHeaderTypeDef *hdr_out, uint8_t *data_out);
extern void MDU_Get_Rx_Queue_Frame(uint8_t index, FDCAN_RxHeaderTypeDef **hdr_out, uint8_t **data_out);
extern void MDU_Advance_Rx_Queue_Head(void);

static const char k_hex_digits[16] = {
  '0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F'
};

extern volatile uint32_t fdcan_tx_count;
extern volatile uint32_t fdcan_rx_count;
extern volatile uint32_t fdcan_rx_error_count;
extern volatile uint32_t fdcan1_debug_cb;

static FDCAN_HandleTypeDef *can_fdcan = NULL;

/**
 * @brief Convert FDCAN DLC encoding to actual byte count.
 * @param dlc Data length code from the FDCAN header.
 * @return Number of payload bytes represented by the DLC.
 */
static uint32_t Convert_DLC_To_Bytes(uint32_t dlc) {
  switch (dlc) {
    case FDCAN_DLC_BYTES_0:  return 0;
    case FDCAN_DLC_BYTES_1:  return 1;
    case FDCAN_DLC_BYTES_2:  return 2;
    case FDCAN_DLC_BYTES_3:  return 3;
    case FDCAN_DLC_BYTES_4:  return 4;
    case FDCAN_DLC_BYTES_5:  return 5;
    case FDCAN_DLC_BYTES_6:  return 6;
    case FDCAN_DLC_BYTES_7:  return 7;
    case FDCAN_DLC_BYTES_8:  return 8;
    case FDCAN_DLC_BYTES_12: return 12;
    case FDCAN_DLC_BYTES_16: return 16;
    case FDCAN_DLC_BYTES_20: return 20;
    case FDCAN_DLC_BYTES_24: return 24;
    case FDCAN_DLC_BYTES_32: return 32;
    case FDCAN_DLC_BYTES_48: return 48;
    case FDCAN_DLC_BYTES_64: return 64;
    default:                return 0;
  }
}

/**
 * @brief Initialize the FDCAN bus instance and enable RX notifications.
 * @param fdcan FDCAN handle to initialize.
 * @return HAL_OK on success; HAL_ERROR on failure.
 */
HAL_StatusTypeDef CAN_Init(FDCAN_HandleTypeDef *fdcan) {
  if (fdcan == NULL) {
    return HAL_ERROR;
  }
  can_fdcan = fdcan;
  if (HAL_FDCAN_Start(can_fdcan) != HAL_OK) {
    return HAL_ERROR;
  }
  if (HAL_FDCAN_ActivateNotification(can_fdcan, FDCAN_IT_RX_FIFO0_NEW_MESSAGE, 0) != HAL_OK) {
    return HAL_ERROR;
  }
  fdcan_tx_count = 0U;
  fdcan_rx_count = 0U;
  fdcan_rx_error_count = 0U;
  fdcan1_debug_cb = 0U;
  return HAL_OK;
}

/**
 * @brief Process periodic CAN tasks.
 * @param now_ms Current system time in milliseconds.
 */
void CAN_Process(uint32_t now_ms) {}

/**
 * @brief Drain all available FDCAN RX queue entries into one batched USB
 *        transfer. Frames stay in the queue if USB is busy so nothing is lost.
 */
void CAN_To_USB_Process(void) {
  // Prevent CPU starvation/busy formatting loop if USB endpoint is busy
  extern USBD_HandleTypeDef hUsbDeviceFS;
  if (hUsbDeviceFS.pClassData != NULL) {
    USBD_CDC_HandleTypeDef *hcdc = (USBD_CDC_HandleTypeDef *)hUsbDeviceFS.pClassData;
    if (hcdc->TxState != 0U) {
      return;
    }
  }

  // FDCAN_RX_QUEUE_SIZE is 128, a full drain of standard frames can take up to ~17 KB.
  // Sized to match the expanded APP_TX_DATA_SIZE (16 KB) to send maximum batch sizes in one transfer.
  static char batch[16384];
  int batch_len = 0;
  int frames_consumed = 0;

  uint8_t head, tail;
  if (!MDU_Get_Rx_Queue_State(&head, &tail)) {
    return;
  }

  uint8_t idx = head;
  while (idx != tail) {
    FDCAN_RxHeaderTypeDef *hdr;
    uint8_t *frame_data;
    MDU_Get_Rx_Queue_Frame(idx, &hdr, &frame_data);

    uint32_t len = Convert_DLC_To_Bytes(hdr->DataLength);
    if (len > 64) len = 64;

    // Reserve space: 1 sync + 2 ID + 1 len + payload len + 1 end
    int needed = 1 + 2 + 1 + (int)len + 1;
    if (batch_len + needed > (int)sizeof(batch)) {
      break;
    }

    batch[batch_len++] = 0xAA; // Sync byte
    batch[batch_len++] = (uint8_t)(hdr->Identifier & 0xFF);
    batch[batch_len++] = (uint8_t)((hdr->Identifier >> 8) & 0xFF);
    batch[batch_len++] = (uint8_t)len;

    for (uint32_t i = 0; i < len; i++) {
      batch[batch_len++] = frame_data[i];
    }
    batch[batch_len++] = 0x55; // End byte

    frames_consumed++;
    idx = (uint8_t)((idx + 1U) % FDCAN_RX_QUEUE_SIZE);
  }

  if (batch_len == 0) {
    return;
  }

  // Single USB transfer for the whole batch. If the endpoint is still busy,
  // leave the frames in the queue and retry next loop iteration.
  if (CDC_Transmit_FS((uint8_t *)batch, (uint16_t)batch_len) == USBD_OK) {
    for (int i = 0; i < frames_consumed; i++) {
      MDU_Advance_Rx_Queue_Head();
    }
  }
}

// Global buffer for SLCAN parsing
static char slcan_buf[32];
static int slcan_idx = 0;

static uint8_t HexCharToNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return 0;
}

extern uint16_t USB_Driver_Available(void);
extern uint16_t USB_Driver_Read(uint8_t *buf, uint16_t len);
extern FDCAN_HandleTypeDef hfdcan1;

void USB_To_CAN_Process(void) {
  uint16_t avail = USB_Driver_Available();
  if (avail == 0) return;

  uint8_t c;
  while (USB_Driver_Read(&c, 1) == 1) {
    if (c == '\r' || c == '\n') {
      if (slcan_idx > 0) {
        slcan_buf[slcan_idx] = '\0';
        
        // Parse basic SLCAN: t[ID3][Len1][Data...]
        if ((slcan_buf[0] == 't' || slcan_buf[0] == 'T') && slcan_idx >= 5) {
          FDCAN_TxHeaderTypeDef txHeader;
          txHeader.IdType = FDCAN_STANDARD_ID;
          txHeader.TxFrameType = FDCAN_DATA_FRAME;
          txHeader.ErrorStateIndicator = FDCAN_ESI_ACTIVE;
          txHeader.BitRateSwitch = FDCAN_BRS_OFF;
          txHeader.FDFormat = FDCAN_FD_CAN;
          txHeader.TxEventFifoControl = FDCAN_NO_TX_EVENTS;
          txHeader.MessageMarker = 0;

          // Parse ID (3 hex chars)
          uint32_t id = (HexCharToNibble(slcan_buf[1]) << 8) | 
                        (HexCharToNibble(slcan_buf[2]) << 4) | 
                        HexCharToNibble(slcan_buf[3]);
          txHeader.Identifier = id;

          // Parse Len (1 hex char)
          uint8_t dlc = HexCharToNibble(slcan_buf[4]);
          txHeader.DataLength = dlc << 16; // Simple map to DLC bytes (0-8 works for FDCAN_DLC_BYTES_x)

          // Parse Data
          uint8_t data[8] = {0};
          if (dlc <= 8 && slcan_idx >= 5 + (dlc * 2)) {
            for (int i = 0; i < dlc; i++) {
              data[i] = (HexCharToNibble(slcan_buf[5 + i*2]) << 4) | HexCharToNibble(slcan_buf[6 + i*2]);
            }
            // Add to Tx FIFO Q
            HAL_FDCAN_AddMessageToTxFifoQ(&hfdcan1, &txHeader, data);
          }
        }
        slcan_idx = 0;
      }
    } else {
      if (slcan_idx < (int)(sizeof(slcan_buf) - 1)) {
        slcan_buf[slcan_idx++] = c;
      } else {
        slcan_idx = 0; // Overflow, reset
      }
    }
  }
}
