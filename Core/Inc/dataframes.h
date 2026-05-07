/*
 * dataframes.h
 *
 *  Created on: Apr 7, 2025
 *      Author: antho
 */

#ifndef INC_DATAFRAMES_H_
#define INC_DATAFRAMES_H_

#include <stdint.h>

typedef union SG_DATAFRAME
{
  struct
  {
    uint16_t SG0;
    uint16_t SG1;
    uint16_t SG2;
    uint16_t SG3;
  } data;
  uint8_t array[8];
} SG_DATAFRAME;

typedef union TTEMP_DATAFRAME
{
  struct
  {
    uint8_t pix0;
    uint8_t pix1;
    uint8_t pix2;
    uint8_t pix3;
    uint8_t pix4;
    uint8_t pix5;
    uint8_t pix6;
    uint8_t pix7;
  } data;
  uint8_t array[8];
} TTEMP_DATAFRAME;

typedef union MISC_DATAFRAME
{
  struct
  {
    uint16_t wheelRPM;
    uint16_t brakeTemp;
    uint16_t shockTravel;
    uint8_t boardTemp;
    struct
    {
      uint8_t ADCErrorBit       : 1;
      uint8_t BrakeTempErrorBit : 1;
      uint8_t MiscMsgErrorBit   : 1;
      uint8_t SGMsgErrorBit     : 1;
      uint8_t TTempMsg1ErrorBit : 1;
      uint8_t TTempMsg2ErrorBit : 1;
      uint8_t TTempMsg3ErrorBit : 1;
      uint8_t TTempMsg4ErrorBit : 1;
    } eflags;
  } data;
  uint8_t array[8];
} MISC_DATAFRAME;

typedef struct CORNER_CAN_CONTEXT
{
  uint32_t ms_since_strain_broadcast;
  SG_DATAFRAME straingauge_dataframe;

  uint32_t ms_since_ttemp_broadcast;
  TTEMP_DATAFRAME ttemp_dataframes[4];

  uint32_t ms_since_miscmsg_broadcast;
  MISC_DATAFRAME misc_dataframe;
} CORNER_CAN_CONTEXT;

#endif /* INC_DATAFRAMES_H_ */
