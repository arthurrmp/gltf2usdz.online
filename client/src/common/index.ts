export type ConvertedFile = {
  id: string;
  expires: number;
  name: string;
};

export enum STATES {
  IDLE,
  DRAGGING,
  LOADING,
  SUCCESS,
  ERROR,
}

export const MESSAGES = {
  [STATES.IDLE]: "Drag and drop your file or click here to convert",
  [STATES.DRAGGING]: "Release your file to begin conversion",
  [STATES.LOADING]: "Converting file. This may take a few minutes",
  [STATES.SUCCESS]: "File converted successfully. Use the link below to download it or click to convert more files.",
  [STATES.ERROR]: "Conversion to USDZ failed.",
} as const;

export const COLORS = {
  [STATES.IDLE]: {
    gradientBackgroundStart: "rgb(11, 0, 162)",
    gradientBackgroundEnd: "rgb(0, 17, 82)",
    firstColor: "1, 37, 92",
    secondColor: "221, 74, 255",
    thirdColor: "100, 220, 255",
    fourthColor: "200, 50, 50",
    fifthColor: "180, 180, 50",
    pointerColor: "209, 194, 252",
  },
  [STATES.DRAGGING]: {
    gradientBackgroundStart: "rgb(0, 162, 162)",
    gradientBackgroundEnd: "rgb(0, 82, 82)",
    firstColor: "1, 92, 92",
    secondColor: "74, 255, 255",
    thirdColor: "100, 255, 255",
    fourthColor: "50, 200, 200",
    fifthColor: "180, 180, 50",
    pointerColor: "209, 252, 252",
  },
  [STATES.LOADING]: {
    gradientBackgroundStart: "rgb(162, 0, 162)",
    gradientBackgroundEnd: "rgb(82, 0, 82)",
    firstColor: "92, 1, 92",
    secondColor: "255, 74, 255",
    thirdColor: "255, 100, 255",
    fourthColor: "200, 50, 200",
    fifthColor: "180, 180, 50",
    pointerColor: "252, 194, 252",
  },
  [STATES.SUCCESS]: {
    gradientBackgroundStart: "rgb(0, 100, 0)",
    gradientBackgroundEnd: "rgb(0, 82, 17)",
    firstColor: "37, 92, 1",
    secondColor: "4, 55, 21",
    thirdColor: "220, 255, 100",
    fourthColor: "50, 200, 50",
    fifthColor: "0, 80, 50",
    pointerColor: "130, 102, 130",
  },
  [STATES.ERROR]: {
    gradientBackgroundStart: "rgb(162, 0, 0)",
    gradientBackgroundEnd: "rgb(82, 17, 0)",
    firstColor: "92, 37, 1",
    secondColor: "255, 74, 221",
    thirdColor: "255, 220, 100",
    fourthColor: "50, 50, 200",
    fifthColor: "180, 180, 50",
    pointerColor: "252, 194, 209",
  },
} as const;

export const LOCAL_STORAGE_KEY = "CONVERTED_FILES";
