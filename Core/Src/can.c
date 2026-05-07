/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file    can.c
  * @brief   Higher-level CAN protocol layer for the corner PCB.
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
#include "can.h"
#include "fdcan.h"

/* USER CODE BEGIN 0 */
static CORNER_CAN_CONTEXT s_can_context;

static uint32_t CAN_TireTempMessageId(uint8_t index)
{
  switch (index)
  {
    case 0U: return TIRE_TEMP_MSG1_ID;
    case 1U: return TIRE_TEMP_MSG2_ID;
    case 2U: return TIRE_TEMP_MSG3_ID;
    case 3U: return TIRE_TEMP_MSG4_ID;
    default: return 0U;
  }
}

static void CAN_HandleReceivedMessage(const FDCAN_RxMessage *message, CORNER_CAN_CONTEXT *context)
{
  (void)message;
  (void)context;
  /* Protocol-specific RX decode gets added here once command IDs are defined. */
}
/* USER CODE END 0 */

HAL_StatusTypeDef CAN_Init(void)
{
  CAN_ResetContext(&s_can_context);
  return HAL_OK;
}

void CAN_ResetContext(CORNER_CAN_CONTEXT *context)
{
  if (context == NULL)
  {
    return;
  }

  context->ms_since_strain_broadcast = 0U;
  context->ms_since_ttemp_broadcast = 0U;
  context->ms_since_miscmsg_broadcast = 0U;

  context->straingauge_dataframe.data.SG0 = 0U;
  context->straingauge_dataframe.data.SG1 = 0U;
  context->straingauge_dataframe.data.SG2 = 0U;
  context->straingauge_dataframe.data.SG3 = 0U;

  for (uint8_t i = 0U; i < TIRE_TEMP_FRAME_COUNT; i++)
  {
    for (uint8_t j = 0U; j < sizeof(context->ttemp_dataframes[i].array); j++)
    {
      context->ttemp_dataframes[i].array[j] = 0U;
    }
  }

  context->misc_dataframe.data.wheelRPM = 0U;
  context->misc_dataframe.data.brakeTemp = 0U;
  context->misc_dataframe.data.shockTravel = 0U;
  context->misc_dataframe.data.boardTemp = 0U;
  CAN_ClearEflags(context);
}

void CAN_ClearEflags(CORNER_CAN_CONTEXT *context)
{
  if (context == NULL)
  {
    return;
  }

  context->misc_dataframe.data.eflags.ADCErrorBit = 0U;
  context->misc_dataframe.data.eflags.BrakeTempErrorBit = 0U;
  context->misc_dataframe.data.eflags.MiscMsgErrorBit = 0U;
  context->misc_dataframe.data.eflags.SGMsgErrorBit = 0U;
  context->misc_dataframe.data.eflags.TTempMsg1ErrorBit = 0U;
  context->misc_dataframe.data.eflags.TTempMsg2ErrorBit = 0U;
  context->misc_dataframe.data.eflags.TTempMsg3ErrorBit = 0U;
  context->misc_dataframe.data.eflags.TTempMsg4ErrorBit = 0U;
}

HAL_StatusTypeDef CAN_TransmitFrame(uint32_t id, const uint8_t *data, uint8_t len)
{
  HAL_StatusTypeDef status = HAL_ERROR;

  for (uint32_t attempt = 0U; attempt < CAN_RETRY_LIMIT; attempt++)
  {
    status = FDCAN_Send_Message(id, data, len);
    if (status == HAL_OK)
    {
      break;
    }
  }

  return status;
}

HAL_StatusTypeDef CAN_SendStrainGauge(const CORNER_CAN_CONTEXT *context)
{
  if (context == NULL)
  {
    return HAL_ERROR;
  }

  return CAN_TransmitFrame(STRAIN_GAUGE_ID,
                           context->straingauge_dataframe.array,
                           sizeof(context->straingauge_dataframe.array));
}

HAL_StatusTypeDef CAN_SendTireTemps(const CORNER_CAN_CONTEXT *context)
{
  HAL_StatusTypeDef status = HAL_OK;

  if (context == NULL)
  {
    return HAL_ERROR;
  }

  if (TTEMP_DISABLED != 0U)
  {
    return HAL_OK;
  }

  for (uint8_t i = 0U; i < TIRE_TEMP_FRAME_COUNT; i++)
  {
    status = CAN_TransmitFrame(CAN_TireTempMessageId(i),
                               context->ttemp_dataframes[i].array,
                               sizeof(context->ttemp_dataframes[i].array));
    if (status != HAL_OK)
    {
      break;
    }
  }

  return status;
}

HAL_StatusTypeDef CAN_SendMisc(const CORNER_CAN_CONTEXT *context)
{
  if (context == NULL)
  {
    return HAL_ERROR;
  }

  return CAN_TransmitFrame(MISC_DATA_ID,
                           context->misc_dataframe.array,
                           sizeof(context->misc_dataframe.array));
}

void CAN_Process(uint32_t now_ms, CORNER_CAN_CONTEXT *context)
{
  HAL_StatusTypeDef status = HAL_OK;
  CORNER_CAN_CONTEXT *active_context = (context != NULL) ? context : &s_can_context;

  CAN_ClearEflags(active_context);

  if ((now_ms - active_context->ms_since_miscmsg_broadcast) >= MISC_DATA_TRANSMISSION_PERIOD)
  {
    status = CAN_SendMisc(active_context);
    active_context->misc_dataframe.data.eflags.MiscMsgErrorBit = (status != HAL_OK);
    active_context->ms_since_miscmsg_broadcast = now_ms;
  }

  if ((now_ms - active_context->ms_since_strain_broadcast) >= STRAIN_GAUGE_TRANSMISSION_PERIOD)
  {
    status = CAN_SendStrainGauge(active_context);
    active_context->misc_dataframe.data.eflags.SGMsgErrorBit = (status != HAL_OK);
    active_context->ms_since_strain_broadcast = now_ms;
  }

  if ((TTEMP_DISABLED == 0U) &&
      ((now_ms - active_context->ms_since_ttemp_broadcast) >= TIRE_TEMP_TRANSMISSION_PERIOD))
  {
    status = CAN_SendTireTemps(active_context);
    active_context->misc_dataframe.data.eflags.TTempMsg1ErrorBit = (status != HAL_OK);
    active_context->misc_dataframe.data.eflags.TTempMsg2ErrorBit = (status != HAL_OK);
    active_context->misc_dataframe.data.eflags.TTempMsg3ErrorBit = (status != HAL_OK);
    active_context->misc_dataframe.data.eflags.TTempMsg4ErrorBit = (status != HAL_OK);
    active_context->ms_since_ttemp_broadcast = now_ms;
  }
}

void CAN_ProcessRx(CORNER_CAN_CONTEXT *context)
{
  FDCAN_RxMessage message;
  CORNER_CAN_CONTEXT *active_context = (context != NULL) ? context : &s_can_context;

  while (FDCAN_GetRxMessage(&message))
  {
    CAN_HandleReceivedMessage(&message, active_context);
  }
}

const CORNER_CAN_CONTEXT *CAN_GetContext(void)
{
  return &s_can_context;
}

CORNER_CAN_CONTEXT *CAN_GetMutableContext(void)
{
  return &s_can_context;
}
