export function trimEdgeSilence(
  samples,
  {
    sampleRate = 24_000,
    frameMs = 10,
    leadingPaddingMs = 10,
    trailingPaddingMs = 25,
  } = {},
) {
  if (samples.length === 0) return samples;

  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak === 0) return samples;

  const frameSize = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const threshold = Math.max(0.0008, peak * 0.008);
  const thresholdSquared = threshold * threshold;
  let firstActiveFrame = -1;
  let lastActiveFrame = -1;

  for (let start = 0, frame = 0; start < samples.length; start += frameSize, frame += 1) {
    const end = Math.min(start + frameSize, samples.length);
    let energy = 0;
    for (let index = start; index < end; index += 1) {
      energy += samples[index] * samples[index];
    }

    if (energy / (end - start) >= thresholdSquared) {
      if (firstActiveFrame === -1) firstActiveFrame = frame;
      lastActiveFrame = frame;
    }
  }

  if (firstActiveFrame === -1) return samples;

  const leadingPadding = Math.round((sampleRate * leadingPaddingMs) / 1000);
  const trailingPadding = Math.round((sampleRate * trailingPaddingMs) / 1000);
  const start = Math.max(0, firstActiveFrame * frameSize - leadingPadding);
  const end = Math.min(
    samples.length,
    (lastActiveFrame + 1) * frameSize + trailingPadding,
  );

  if (start === 0 && end === samples.length) return samples;
  return samples.slice(start, end);
}
