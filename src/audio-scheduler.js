export class AudioScheduler {
  constructor({
    getContext,
    onChange = () => {},
    onError = (error) => console.error("Unable to play generated speech", error),
    leadTimeSeconds = 0.015,
  }) {
    this.getContext = getContext;
    this.onChange = onChange;
    this.onError = onError;
    this.leadTimeSeconds = leadTimeSeconds;
    this.items = [];
    this.sources = new Set();
    this.nextStartTime = 0;
    this.scheduling = false;
  }

  enqueue(item) {
    this.items.push(item);
    this.#notify();
    void this.#drain();
  }

  dispose() {
    this.items.length = 0;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // The source may already have ended while the window is closing.
      }
    }
    this.sources.clear();
    this.nextStartTime = 0;
    this.#notify();
  }

  async #drain() {
    if (this.scheduling) return;
    this.scheduling = true;

    try {
      const context = this.getContext();
      if (context.state === "suspended") await context.resume();

      while (this.items.length > 0) {
        const { samples, sampleRate } = this.items.shift();
        try {
          const pcm = samples instanceof Float32Array ? samples : new Float32Array(samples);
          if (pcm.length === 0) continue;

          const buffer = context.createBuffer(1, pcm.length, sampleRate);
          buffer.copyToChannel(pcm, 0);

          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(context.destination);

          const startTime = Math.max(
            context.currentTime + this.leadTimeSeconds,
            this.nextStartTime,
          );
          this.nextStartTime = startTime + buffer.duration;
          this.sources.add(source);
          source.addEventListener(
            "ended",
            () => {
              this.sources.delete(source);
              if (this.sources.size === 0 && this.items.length === 0) this.nextStartTime = 0;
              this.#notify();
            },
            { once: true },
          );
          source.start(startTime);
          this.#notify();
        } catch (error) {
          this.onError(error);
        }
      }
    } catch (error) {
      this.items.length = 0;
      this.onError(error);
    } finally {
      this.scheduling = false;
      this.#notify();
      if (this.items.length > 0) void this.#drain();
    }
  }

  #notify() {
    this.onChange({
      queued: this.items.length + Math.max(0, this.sources.size - 1),
      playing: this.sources.size > 0,
    });
  }
}
