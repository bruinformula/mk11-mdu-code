/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file    can.h
  * @brief   Protocol-facing CAN API built on top of raw FDCAN transport.
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
#ifndef __CAN_H__
#define __CAN_H__

#ifdef __cplusplus
extern "C" {
#endif

/* Includes ------------------------------------------------------------------*/
#include "main.h"

/* USER CODE BEGIN Includes */
#include "dataframes.h"
#include <stdbool.h>
#include <stdint.h>
/* USER CODE END Includes */

/* USER CODE BEGIN Private defines */
#define CORNER_NUMBER                    2U

#define STRAIN_GAUGE_ID                  (0x700U | (CORNER_NUMBER << 4))
#define TIRE_TEMP_MSG1_ID                (0x701U | (CORNER_NUMBER << 4))
#define TIRE_TEMP_MSG2_ID                (0x702U | (CORNER_NUMBER << 4))
#define TIRE_TEMP_MSG3_ID                (0x703U | (CORNER_NUMBER << 4))
#define TIRE_TEMP_MSG4_ID                (0x704U | (CORNER_NUMBER << 4))
#define MISC_DATA_ID                     (0x705U | (CORNER_NUMBER << 4))

#define TIRE_TEMP_FRAME_COUNT            4U
#define TTEMP_DISABLED                   1U
#define CAN_RETRY_LIMIT                  3U

#define STRAIN_GAUGE_TRANSMISSION_PERIOD 3U
#define TIRE_TEMP_TRANSMISSION_PERIOD    501U
#define MISC_DATA_TRANSMISSION_PERIOD    21U

#define STRAIN_GAUGE_SAMPLE_PERIOD       4U
#define TIRE_TEMP_SAMPLE_PERIOD          501U
#define WHEEL_SPEED_SAMPLE_PERIOD        11U
#define BRAKE_TEMP_SAMPLE_PERIOD         101U
#define SHOCK_TRAVEL_SAMPLE_PERIOD       10U
#define BOARD_TEMP_SAMPLE_PERIOD         1001U

#define STRAIN_GAUGE_SF                  10U
#define TIRE_TEMP_SF                     4U
#define WHEEL_SPEED_SF                   1U
#define BRAKE_TEMP_SF                    10U
#define SHOCK_TRAVEL_SF                  1000U
#define BOARD_TEMP_SF                    1000U
/* USER CODE END Private defines */

/* USER CODE BEGIN Prototypes */
HAL_StatusTypeDef CAN_Init(void);
void CAN_ResetContext(CORNER_CAN_CONTEXT *context);
void CAN_ClearEflags(CORNER_CAN_CONTEXT *context);

HAL_StatusTypeDef CAN_TransmitFrame(uint32_t id, const uint8_t *data, uint8_t len);
HAL_StatusTypeDef CAN_SendStrainGauge(const CORNER_CAN_CONTEXT *context);
HAL_StatusTypeDef CAN_SendTireTemps(const CORNER_CAN_CONTEXT *context);
HAL_StatusTypeDef CAN_SendMisc(const CORNER_CAN_CONTEXT *context);

void CAN_Process(uint32_t now_ms, CORNER_CAN_CONTEXT *context);
void CAN_ProcessRx(CORNER_CAN_CONTEXT *context);

const CORNER_CAN_CONTEXT *CAN_GetContext(void);
CORNER_CAN_CONTEXT *CAN_GetMutableContext(void);
/* USER CODE END Prototypes */

#ifdef __cplusplus
}
#endif

#endif /* __CAN_H__ */
