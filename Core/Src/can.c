#include "can.h"
#include "fdcan.h"
#include "usb_device.h"
#include "usbd_cdc_if.h"
#include <stdio.h>
#include <string.h>

extern volatile uint32_t fdcan_tx_count;
extern volatile uint32_t fdcan_rx_count;
extern volatile uint32_t fdcan_rx_error_count;
extern volatile uint32_t fdcan1_debug_cb;

static FDCAN_HandleTypeDef *can_fdcan = NULL;
HAL_StatusTypeDef CAN_Init(FDCAN_HandleTypeDef *fdcan) {
  FDCAN_FilterTypeDef sFilterConfig = {0};

  if (fdcan == NULL) {
    return HAL_ERROR;
  }

  can_fdcan = fdcan;

  sFilterConfig.IdType = FDCAN_STANDARD_ID;
  sFilterConfig.FilterIndex = 0;
  sFilterConfig.FilterType = FDCAN_FILTER_RANGE;
  sFilterConfig.FilterConfig = FDCAN_FILTER_TO_RXFIFO0;
  sFilterConfig.FilterID1 = 0x000;
  sFilterConfig.FilterID2 = 0x7FF;

  if (HAL_FDCAN_ConfigFilter(can_fdcan, &sFilterConfig) != HAL_OK) {
    return HAL_ERROR;
  }

  if (HAL_FDCAN_Start(can_fdcan) != HAL_OK) {
    return HAL_ERROR;
  }

  if (HAL_FDCAN_ActivateNotification(can_fdcan, FDCAN_IT_RX_FIFO0_NEW_MESSAGE,
                                     0) != HAL_OK) {
    return HAL_ERROR;
  }

  fdcan_tx_count = 0U;
  fdcan_rx_count = 0U;
  fdcan_rx_error_count = 0U;
  fdcan1_debug_cb = 0U;

  return HAL_OK;
}

void CAN_Process(uint32_t now_ms) {
  // Add cyclic CAN processing here
}

void CAN_To_USB_Process(void) {
  FDCAN_RxMessage msg;
  char slcan_buf[160];
  uint8_t usb_status;

  if (FDCAN_GetRxMessage(&msg)) {
    int offset = 0;
    if (msg.id_type == FDCAN_STANDARD_ID) {
      offset +=
          snprintf(slcan_buf + offset, sizeof(slcan_buf) - offset, "t%03lX%d",
                   (unsigned long)msg.identifier, msg.data_length);
    } else {
      offset +=
          snprintf(slcan_buf + offset, sizeof(slcan_buf) - offset, "T%08lX%d",
                   (unsigned long)msg.identifier, msg.data_length);
    }

    for (int i = 0; i < msg.data_length; i++) {
      offset += snprintf(slcan_buf + offset, sizeof(slcan_buf) - offset, "%02X",
                         msg.data[i]);
    }
    slcan_buf[offset++] = '\r';
    slcan_buf[offset] = '\0';

    uint32_t timeout = 10000;
    do {
      usb_status = CDC_Transmit_FS((uint8_t *)slcan_buf, offset);
      timeout--;
    } while (usb_status == USBD_BUSY && timeout > 0);
  }
}