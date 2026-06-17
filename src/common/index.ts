export type ConvertedFile = {
  name: string;
  url: string;
  size: number;
};

export type Status = "idle" | "dragging" | "working" | "success" | "error";
