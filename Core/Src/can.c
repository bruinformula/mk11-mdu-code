#include "can.h"
#include "fdcan.h"
#include "usb_device.h"
#include "usbd_cdc_if.h"
#include <stdio.h>
#include <string.h>

extern uint8_t MDU_Get_Rx_Queue_State(uint8_t *head_out, uint8_t *tail_out);
extern void MDU_Get_Rx_Queue_Data(uint8_t index, FDCAN_RxHeaderTypeDef *hdr_out, uint8_t *data_out);
extern void MDU_Advance_Rx_Queue_Head(void);

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
 * @brief Convert one queued FDCAN frame into an SLCAN line and send over USB.
 */
void CAN_To_USB_Process(void) {
  char slcan_buf[256];
  uint8_t usb_status;
  uint8_t current_head, current_tail;

  if (MDU_Get_Rx_Queue_State(&current_head, &current_tail)) {
    FDCAN_RxHeaderTypeDef hdr;
    uint8_t frame_data[64];

    MDU_Get_Rx_Queue_Data(current_head, &hdr, frame_data);

    uint32_t len = Convert_DLC_To_Bytes(hdr.DataLength);
    if (len > 64) len = 64;

    int offset = 0;

    if (hdr.IdType == FDCAN_STANDARD_ID) {
      offset += snprintf(slcan_buf + offset, sizeof(slcan_buf) - offset, "t%03lX%lu",
                         (unsigned long)hdr.Identifier, (unsigned long)len);
    } else {
      offset += snprintf(slcan_buf + offset, sizeof(slcan_buf) - offset, "T%08lX%lu",
                         (unsigned long)hdr.Identifier, (unsigned long)len);
    }

    for (uint32_t i = 0; i < len; i++) {
      offset += snprintf(slcan_buf + offset, sizeof(slcan_buf) - offset, "%02X", frame_data[i]);
    }

    slcan_buf[offset++] = '\r';
    slcan_buf[offset] = '\0';

    MDU_Advance_Rx_Queue_Head();

    uint32_t timeout = 10000;
    do {
      usb_status = CDC_Transmit_FS((uint8_t *)slcan_buf, offset);
      timeout--;
    } while (usb_status == USBD_BUSY && timeout > 0);
  }
}
