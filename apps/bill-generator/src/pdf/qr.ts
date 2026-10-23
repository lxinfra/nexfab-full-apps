import QRCode from 'qrcode';

/**
 * Builds a standard UPI intent string and renders it as a PNG data URL.
 * Any UPI app can scan it to pay the exact invoice amount.
 */
export async function upiQrDataUrl(opts: {
  upiId: string;
  payeeName: string;
  amountPaise?: number;
  note?: string;
}): Promise<string | null> {
  if (!opts.upiId) return null;
  const params = new URLSearchParams({
    pa: opts.upiId,
    pn: opts.payeeName,
    cu: 'INR',
  });
  if (opts.amountPaise && opts.amountPaise > 0) {
    params.set('am', (opts.amountPaise / 100).toFixed(2));
  }
  if (opts.note) params.set('tn', opts.note.slice(0, 50));

  try {
    return await QRCode.toDataURL(`upi://pay?${params.toString()}`, {
      margin: 0,
      width: 220,
      errorCorrectionLevel: 'M',
    });
  } catch {
    return null;
  }
}
