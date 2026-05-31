/* USER CODE BEGIN Header */
/**
 ******************************************************************************
 * @file           : usbd_conf.h
 * @version        : v3.0_Cube
 * @brief          : Header for usbd_conf.c file.
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

/* Define to prevent recursive inclusion -------------------------------------*/
#ifndef __USBD_CONF__H__
#define __USBD_CONF__H__

#ifdef __cplusplus
 extern "C" {
#endif

/* Includes ------------------------------------------------------------------*/
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "stm32l5xx.h"
#include "stm32l5xx_hal.h"

/* USER CODE BEGIN INCLUDE */

/* USER CODE END INCLUDE */

/** @addtogroup USBD_OTG_DRIVER
  * @brief Driver for Usb device.
  * @{
  */

/** @defgroup USBD_CONF USBD_CONF
  * @brief Configuration file for Usb otg low level driver.
  * @{
  */

/** @defgroup USBD_CONF_Exported_Variables USBD_CONF_Exported_Variables
  * @brief Public variables.
  * @{
  */

/* Private variables ---------------------------------------------------------*/
/* USER CODE BEGIN PV */
  typedef struct
  {
    uint32_t setup_stage_count;
    uint32_t data_out_stage_count;
    uint32_t data_in_stage_count;
    uint32_t reset_count;
    uint32_t suspend_count;
    uint32_t resume_count;
    uint32_t connect_count;
    uint32_t disconnect_count;
    uint32_t last_event_tick;
    uint32_t ll_init_count;
    uint32_t ll_init_error_count;
    uint32_t ll_start_count;
    uint32_t ll_start_error_count;
    uint32_t ll_open_ep_count;
    uint32_t irq_count;
    uint32_t ctr_irq_flag_count;
    uint32_t reset_irq_flag_count;
    uint32_t susp_irq_flag_count;
    uint32_t esof_irq_flag_count;
    uint32_t wkup_irq_flag_count;
    uint32_t err_irq_flag_count;
    uint32_t pmaovr_irq_flag_count;
    uint32_t last_istr_snapshot;
    uint32_t dppu_assert_count;
    uint32_t last_bcdr_snapshot;
    uint8_t last_setup_bm_request_type;
    uint8_t last_setup_b_request;
    uint16_t last_setup_w_value;
    uint16_t last_setup_w_index;
    uint16_t last_setup_w_length;
    uint32_t tx_drop_count;
    uint32_t configured_seen_count;
  } USB_Diag_t;
  extern volatile USB_Diag_t usbdiag;

/* USER CODE END PV */
/**
  * @}
  */

/** @defgroup USBD_CONF_Exported_Defines USBD_CONF_Exported_Defines
  * @brief Defines for configuration of the Usb device.
  * @{
  */

/*---------- -----------*/
#define USBD_MAX_NUM_INTERFACES     1U
/*---------- -----------*/
#define USBD_MAX_NUM_CONFIGURATION     1U
/*---------- -----------*/
#define USBD_MAX_STR_DESC_SIZ     512U
/*---------- -----------*/
#define USBD_DEBUG_LEVEL     0U
/*---------- -----------*/
#define USBD_LPM_ENABLED     1U
/*---------- -----------*/
#define USBD_SELF_POWERED     1U

/****************************************/
/* #define for FS and HS identification */
#define DEVICE_FS 		0

/**
  * @}
  */

/** @defgroup USBD_CONF_Exported_Macros USBD_CONF_Exported_Macros
  * @brief Aliases.
  * @{
  */

/* Memory management macros */
/** Alias for memory allocation. */
#define USBD_malloc         (void *)USBD_static_malloc

/** Alias for memory release. */
#define USBD_free           USBD_static_free

/** Alias for memory set. */
#define USBD_memset         memset

/** Alias for memory copy. */
#define USBD_memcpy         memcpy

/** Alias for delay. */
#define USBD_Delay          HAL_Delay
/* DEBUG macros */

#if (USBD_DEBUG_LEVEL > 0)
#define USBD_UsrLog(...)    printf(__VA_ARGS__);\
                            printf("\n");
#else
#define USBD_UsrLog(...)
#endif /* (USBD_DEBUG_LEVEL > 0U) */

#if (USBD_DEBUG_LEVEL > 1)

#define USBD_ErrLog(...)    printf("ERROR: ");\
                            printf(__VA_ARGS__);\
                            printf("\n");
#else
#define USBD_ErrLog(...)
#endif /* (USBD_DEBUG_LEVEL > 1U) */

#if (USBD_DEBUG_LEVEL > 2)
#define USBD_DbgLog(...)    printf("DEBUG : ");\
                            printf(__VA_ARGS__);\
                            printf("\n");
#else
#define USBD_DbgLog(...)
#endif /* (USBD_DEBUG_LEVEL > 2U) */

/**
  * @}
  */

/** @defgroup USBD_CONF_Exported_Types USBD_CONF_Exported_Types
  * @brief Types.
  * @{
  */

/**
  * @}
  */

/** @defgroup USBD_CONF_Exported_FunctionsPrototype USBD_CONF_Exported_FunctionsPrototype
  * @brief Declaration of public functions for Usb device.
  * @{
  */

/* Exported functions -------------------------------------------------------*/
void *USBD_static_malloc(uint32_t size);
void USBD_static_free(void *p);

/**
  * @}
  */

/**
  * @}
  */

/**
  * @}
  */

#ifdef __cplusplus
}
#endif

#endif /* __USBD_CONF__H__ */

