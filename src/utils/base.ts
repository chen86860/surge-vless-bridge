export const toBoolean = (value: string | null): boolean => {
  if (!value) {
    return false;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};
