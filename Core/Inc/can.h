#ifndef CAN_H
#define CAN_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"
#include <stdint.h>

extern volatile uint32_t fdcan_tx_count;
extern volatile uint32_t fdcan_rx_count;
extern volatile uint32_t fdcan_rx_error_count;
extern volatile uint32_t fdcan1_debug_cb;

HAL_StatusTypeDef CAN_Init(FDCAN_HandleTypeDef *fdcan);
void CAN_Process(uint32_t now_ms);
void CAN_To_USB_Process(void);

#ifdef __cplusplus
}
#endif

#endif /* CAN_H */
