export const sanitizePlainText = (value: string, maxLength = 5000) => {
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();
};

export const isSafeHttpUrl = (value: string) => {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};
