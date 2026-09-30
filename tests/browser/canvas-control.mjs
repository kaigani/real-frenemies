/** Click the rendered widget's public bounds, so layout changes do not couple tests to old coordinates. */
export async function control(canvas, id) {
  const key = JSON.stringify(id);
  await canvas.locator(`xpath=self::*[contains(@data-controls, '${key}')]`).waitFor();
  const widget = await canvas.evaluate((c, id) => new Promise((resolve, reject) => {
    const start = performance.now();
    const poll = () => {
      const widget = JSON.parse(c.dataset.controls).find(w => w.id === id);
      if (widget && !widget.disabled) resolve(widget);
      else if (performance.now() - start > 5000) reject(new Error(`Unavailable canvas control: ${id}`));
      else requestAnimationFrame(poll);
    };
    poll();
  }), id);
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: (widget.x + widget.w / 2) * box.width / 640, y: (widget.y + widget.h / 2) * box.height / 480 } });
}
