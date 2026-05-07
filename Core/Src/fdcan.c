/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file    fdcan.c
  * @brief   This file provides code for the configuration
  *          of the FDCAN instances.
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
#include "fdcan.h"

/* USER CODE BEGIN 0 */
volatile uint32_t fdcan_tx_count = 0U;
volatile uint32_t fdcan_rx_count = 0U;
volatile uint32_t fdcan_rx_error_count = 0U;
volatile uint32_t fdcan1_debug_cb = 0U;

static volatile uint8_t s_fdcan_rx_head = 0U;
static volatile uint8_t s_fdcan_rx_tail = 0U;
static FDCAN_RxMessage s_fdcan_rx_queue[FDCAN_RX_QUEUE_SIZE];

static uint32_t FDCAN_EncodeDlc(uint8_t len)
{
  switch (len)
  {
    case 0: return FDCAN_DLC_BYTES_0;
    case 1: return FDCAN_DLC_BYTES_1;
    case 2: return FDCAN_DLC_BYTES_2;
    case 3: return FDCAN_DLC_BYTES_3;
    case 4: return FDCAN_DLC_BYTES_4;
    case 5: return FDCAN_DLC_BYTES_5;
    case 6: return FDCAN_DLC_BYTES_6;
    case 7: return FDCAN_DLC_BYTES_7;
    default: return FDCAN_DLC_BYTES_8;
  }
}

static uint8_t FDCAN_DecodeDlc(uint32_t dlc)
{
  switch (dlc)
  {
    case FDCAN_DLC_BYTES_0: return 0;
    case FDCAN_DLC_BYTES_1: return 1;
    case FDCAN_DLC_BYTES_2: return 2;
    case FDCAN_DLC_BYTES_3: return 3;
    case FDCAN_DLC_BYTES_4: return 4;
    case FDCAN_DLC_BYTES_5: return 5;
    case FDCAN_DLC_BYTES_6: return 6;
    case FDCAN_DLC_BYTES_7: return 7;
    case FDCAN_DLC_BYTES_8: return 8;
    default: return 8;
  }
}

static void FDCAN_ResetQueue(void)
{
  uint32_t primask = __get_PRIMASK();

  __disable_irq();
  s_fdcan_rx_head = 0U;
  s_fdcan_rx_tail = 0U;
  if (primask == 0U)
  {
    __enable_irq();
  }
}

static HAL_StatusTypeDef FDCAN_PushRxMessage(const FDCAN_RxMessage *message)
{
  HAL_StatusTypeDef status = HAL_OK;
  uint8_t next_head = 0U;
  uint32_t primask = __get_PRIMASK();

  __disable_irq();
  next_head = (uint8_t)((s_fdcan_rx_head + 1U) % FDCAN_RX_QUEUE_SIZE);
  if (next_head == s_fdcan_rx_tail)
  {
    status = HAL_ERROR;
  }
  else
  {
    s_fdcan_rx_queue[s_fdcan_rx_head] = *message;
    s_fdcan_rx_head = next_head;
  }

  if (primask == 0U)
  {
    __enable_irq();
  }

  return status;
}
/* USER CODE END 0 */

FDCAN_HandleTypeDef hfdcan1;

/* FDCAN1 init function */
void MX_FDCAN1_Init(void)
{

  /* USER CODE BEGIN FDCAN1_Init 0 */

  /* USER CODE END FDCAN1_Init 0 */

  /* USER CODE BEGIN FDCAN1_Init 1 */

  /* USER CODE END FDCAN1_Init 1 */
  hfdcan1.Instance = FDCAN1;
  hfdcan1.Init.ClockDivider = FDCAN_CLOCK_DIV1;
  hfdcan1.Init.FrameFormat = FDCAN_FRAME_CLASSIC;
  hfdcan1.Init.Mode = FDCAN_MODE_EXTERNAL_LOOPBACK;
  hfdcan1.Init.AutoRetransmission = ENABLE;
  hfdcan1.Init.TransmitPause = DISABLE;
  hfdcan1.Init.ProtocolException = DISABLE;
  hfdcan1.Init.NominalPrescaler = 11;
  hfdcan1.Init.NominalSyncJumpWidth = 2;
  hfdcan1.Init.NominalTimeSeg1 = 17;
  hfdcan1.Init.NominalTimeSeg2 = 2;
  hfdcan1.Init.DataPrescaler = 11;
  hfdcan1.Init.DataSyncJumpWidth = 2;
  hfdcan1.Init.DataTimeSeg1 = 17;
  hfdcan1.Init.DataTimeSeg2 = 2;
  hfdcan1.Init.StdFiltersNbr = 1;
  hfdcan1.Init.ExtFiltersNbr = 0;
  hfdcan1.Init.TxFifoQueueMode = FDCAN_TX_FIFO_OPERATION;
  if (HAL_FDCAN_Init(&hfdcan1) != HAL_OK)
  {
    Error_Handler();
  }
  /* USER CODE BEGIN FDCAN1_Init 2 */

  /* USER CODE END FDCAN1_Init 2 */

}

void HAL_FDCAN_MspInit(FDCAN_HandleTypeDef* fdcanHandle)
{

  GPIO_InitTypeDef GPIO_InitStruct = {0};
  RCC_PeriphCLKInitTypeDef PeriphClkInit = {0};
  if(fdcanHandle->Instance==FDCAN1)
  {
  /* USER CODE BEGIN FDCAN1_MspInit 0 */

  /* USER CODE END FDCAN1_MspInit 0 */

  /** Initializes the peripherals clock
  */
    PeriphClkInit.PeriphClockSelection = RCC_PERIPHCLK_FDCAN;
    PeriphClkInit.FdcanClockSelection = RCC_FDCANCLKSOURCE_PLL;
    if (HAL_RCCEx_PeriphCLKConfig(&PeriphClkInit) != HAL_OK)
    {
      Error_Handler();
    }

    /* FDCAN1 clock enable */
    __HAL_RCC_FDCAN1_CLK_ENABLE();

    __HAL_RCC_GPIOB_CLK_ENABLE();
    /**FDCAN1 GPIO Configuration
    PB8     ------> FDCAN1_RX
    PB9     ------> FDCAN1_TX
    */
    GPIO_InitStruct.Pin = GPIO_PIN_8|GPIO_PIN_9;
    GPIO_InitStruct.Mode = GPIO_MODE_AF_PP;
    GPIO_InitStruct.Pull = GPIO_NOPULL;
    GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
    GPIO_InitStruct.Alternate = GPIO_AF9_FDCAN1;
    HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);

  /* USER CODE BEGIN FDCAN1_MspInit 1 */

  /* USER CODE END FDCAN1_MspInit 1 */
  }
}

void HAL_FDCAN_MspDeInit(FDCAN_HandleTypeDef* fdcanHandle)
{

  if(fdcanHandle->Instance==FDCAN1)
  {
  /* USER CODE BEGIN FDCAN1_MspDeInit 0 */

  /* USER CODE END FDCAN1_MspDeInit 0 */
    /* Peripheral clock disable */
    __HAL_RCC_FDCAN1_CLK_DISABLE();

    /**FDCAN1 GPIO Configuration
    PB8     ------> FDCAN1_RX
    PB9     ------> FDCAN1_TX
    */
    HAL_GPIO_DeInit(GPIOB, GPIO_PIN_8|GPIO_PIN_9);

  /* USER CODE BEGIN FDCAN1_MspDeInit 1 */

  /* USER CODE END FDCAN1_MspDeInit 1 */
  }
}

/* USER CODE BEGIN 1 */
HAL_StatusTypeDef FDCAN_App_Init(void)
{
  FDCAN_FilterTypeDef std_filter = {0};

  std_filter.IdType = FDCAN_STANDARD_ID;
  std_filter.FilterIndex = 0;
  std_filter.FilterType = FDCAN_FILTER_RANGE;
  std_filter.FilterConfig = FDCAN_FILTER_TO_RXFIFO0;
  std_filter.FilterID1 = FDCAN_ACCEPTED_STD_ID_BASE;
  std_filter.FilterID2 = FDCAN_ACCEPTED_STD_ID_MASK;

  if (HAL_FDCAN_ConfigFilter(&hfdcan1, &std_filter) != HAL_OK)
  {
    return HAL_ERROR;
  }

  if (HAL_FDCAN_ConfigGlobalFilter(&hfdcan1,
                                   FDCAN_REJECT,
                                   FDCAN_REJECT,
                                   FDCAN_REJECT_REMOTE,
                                   FDCAN_REJECT_REMOTE) != HAL_OK)
  {
    return HAL_ERROR;
  }

  FDCAN_ResetQueue();
  fdcan_tx_count = 0U;
  fdcan_rx_count = 0U;
  fdcan_rx_error_count = 0U;
  fdcan1_debug_cb = 0U;

  return HAL_OK;
}

HAL_StatusTypeDef FDCAN_Send_Message(uint32_t id, const uint8_t *data, uint8_t len)
{
  FDCAN_TxHeaderTypeDef tx_header = {0};
  uint8_t tx_data[8] = {0};

  if (len > 8U)
  {
    len = 8U;
  }

  if ((len > 0U) && (data == NULL))
  {
    return HAL_ERROR;
  }

  if ((data != NULL) && (len > 0U))
  {
    memcpy(tx_data, data, len);
  }

  tx_header.Identifier = id;
  tx_header.IdType = (id <= 0x7FFU) ? FDCAN_STANDARD_ID : FDCAN_EXTENDED_ID;
  tx_header.TxFrameType = FDCAN_DATA_FRAME;
  tx_header.DataLength = FDCAN_EncodeDlc(len);
  tx_header.ErrorStateIndicator = FDCAN_ESI_ACTIVE;
  tx_header.BitRateSwitch = FDCAN_BRS_OFF;
  tx_header.FDFormat = FDCAN_CLASSIC_CAN;
  tx_header.TxEventFifoControl = FDCAN_NO_TX_EVENTS;
  tx_header.MessageMarker = 0U;

  if (HAL_FDCAN_AddMessageToTxFifoQ(&hfdcan1, &tx_header, tx_data) != HAL_OK)
  {
    return HAL_ERROR;
  }

  fdcan_tx_count++;
  return HAL_OK;
}

void FDCAN_Receive_Callback(FDCAN_HandleTypeDef *hfdcan)
{
  FDCAN_RxHeaderTypeDef rx_header = {0};
  uint8_t rx_data[8] = {0};
  FDCAN_RxMessage message = {0};

  if (HAL_FDCAN_GetRxMessage(hfdcan, FDCAN_RX_FIFO0, &rx_header, rx_data) != HAL_OK)
  {
    fdcan_rx_error_count++;
    return;
  }

  message.identifier = rx_header.Identifier;
  message.data_length = FDCAN_DecodeDlc(rx_header.DataLength);
  message.id_type = rx_header.IdType;
  message.frame_type = rx_header.RxFrameType;
  memcpy(message.data, rx_data, message.data_length);

  if (FDCAN_PushRxMessage(&message) != HAL_OK)
  {
    fdcan_rx_error_count++;
    return;
  }

  fdcan_rx_count++;
}

bool FDCAN_GetRxMessage(FDCAN_RxMessage *message)
{
  uint32_t primask = 0U;

  if (message == NULL)
  {
    return false;
  }

  primask = __get_PRIMASK();
  __disable_irq();

  if (s_fdcan_rx_head == s_fdcan_rx_tail)
  {
    if (primask == 0U)
    {
      __enable_irq();
    }
    return false;
  }

  *message = s_fdcan_rx_queue[s_fdcan_rx_tail];
  s_fdcan_rx_tail = (uint8_t)((s_fdcan_rx_tail + 1U) % FDCAN_RX_QUEUE_SIZE);

  if (primask == 0U)
  {
    __enable_irq();
  }

  return true;
}

void HAL_FDCAN_RxFifo0Callback(FDCAN_HandleTypeDef *hfdcan, uint32_t RxFifo0ITs)
{
  fdcan1_debug_cb++;
  if ((RxFifo0ITs & FDCAN_IT_RX_FIFO0_NEW_MESSAGE) != 0U)
  {
    FDCAN_Receive_Callback(hfdcan);
  }
}
/* USER CODE END 1 */
