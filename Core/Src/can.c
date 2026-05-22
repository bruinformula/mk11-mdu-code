#include "can.h"
#include "fdcan.h"
#include "usb_device.h"
#include "usbd_cdc_if.h"
#include <stdio.h>
#include <string.h>

extern uint8_t MDU_Get_Rx_Queue_State(uint8_t *head_out, uint8_t *tail_out);
extern void MDU_Get_Rx_Queue_Data(uint8_t index, FDCAN_RxHeaderTypeDef *hdr_out, uint8_t *data_out);
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
  // Per-frame worst case: "T" + 8 hex id + 2 dlc digits + 64*2 hex payload + "\r" = 140
  // FDCAN_RX_QUEUE_SIZE is 8, so a full drain is ~1.1 KB; cap below APP_TX_DATA_SIZE.
  static char batch[1536];
  int batch_len = 0;
  int frames_consumed = 0;

  uint8_t head, tail;
  if (!MDU_Get_Rx_Queue_State(&head, &tail)) {
    return;
  }

  uint8_t idx = head;
  while (idx != tail) {
    FDCAN_RxHeaderTypeDef hdr;
    uint8_t frame_data[64];
    MDU_Get_Rx_Queue_Data(idx, &hdr, frame_data);

    uint32_t len = Convert_DLC_To_Bytes(hdr.DataLength);
    if (len > 64) len = 64;

    // Reserve worst-case room for this line; stop batching if it would overflow.
    int needed = 11 + (int)(len * 2) + 1;
    if (batch_len + needed > (int)sizeof(batch)) {
      break;
    }

    int n;
    if (hdr.IdType == FDCAN_STANDARD_ID) {
      n = snprintf(batch + batch_len, sizeof(batch) - batch_len, "t%03lX%lu",
                   (unsigned long)hdr.Identifier, (unsigned long)len);
    } else {
      n = snprintf(batch + batch_len, sizeof(batch) - batch_len, "T%08lX%lu",
                   (unsigned long)hdr.Identifier, (unsigned long)len);
    }
    if (n <= 0) {
      break;
    }
    batch_len += n;

    for (uint32_t i = 0; i < len; i++) {
      uint8_t b = frame_data[i];
      batch[batch_len++] = k_hex_digits[b >> 4];
      batch[batch_len++] = k_hex_digits[b & 0x0F];
    }
    batch[batch_len++] = '\r';

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
