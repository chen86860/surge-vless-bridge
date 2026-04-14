export const decodeSubscription = (raw: string): string => {
  let bufferObj = Buffer.from(raw, 'base64');

  // Encode the Buffer as a utf8 string
  let decodedString = bufferObj.toString('utf8');

  return decodedString;
};
