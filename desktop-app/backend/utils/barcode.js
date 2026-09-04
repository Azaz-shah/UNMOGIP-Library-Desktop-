import bwipjs from 'bwip-js';

// Generate barcode image as PNG buffer
export const generateBarcode = async (data, options = {}) => {
  try {
    const opts = {
      bcid: options.type || 'code128',     // Barcode type
      text: data,                           // Text to encode
      scale: options.scale || 3,            // Scale factor
      height: options.height || 15,         // Bar height in mm
      includetext: options.includetext || false, // No text in barcode image — shown separately below
      textxalign: 'center',
      backgroundcolor: 'FFFFFF',
      color: '000000',
      ...options,
    };
    const buffer = await bwipjs.toBuffer(opts);
    return buffer;
  } catch (error) {
    console.error('Barcode generation error:', error);
    throw error;
  }
};

// Generate barcode as base64 data URL
export const generateBarcodeDataURL = async (data, options = {}) => {
  const buffer = await generateBarcode(data, options);
  return `data:image/png;base64,${buffer.toString('base64')}`;
};

// Generate unique book barcode
export const generateBookBarcode = (isbn, index = 0) => {
  const prefix = 'UNM-BK';
  const timestamp = Date.now().toString(36).toUpperCase();
  const suffix = String(index).padStart(3, '0');
  return `${prefix}-${isbn || timestamp}-${suffix}`;
};

// Generate unique employee barcode
export const generateEmployeeBarcode = (employeeId) => {
  const prefix = 'UNM-EMP';
  return `${prefix}-${employeeId}`;
};
