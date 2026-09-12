/**
 * 输入事件处理系统
 */

class InputHandler {
  constructor(canvas, callbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this._bindEvents();
  }

  _bindEvents() {
    this.canvas.addEventListener('mousedown', (e) => this._handleMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this._handleMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this._handleMouseUp(e));
    this.canvas.addEventListener('click', (e) => this._handleClick(e));
    this.canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this._handleRightClick(e); });
  }

  getMousePos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  _handleMouseDown(e) {
    const pos = this.getMousePos(e);
    if (this.callbacks.onMouseDown) this.callbacks.onMouseDown(pos);
  }

  _handleMouseMove(e) {
    const pos = this.getMousePos(e);
    if (this.callbacks.onMouseMove) this.callbacks.onMouseMove(pos);
  }

  _handleMouseUp(e) {
    const pos = this.getMousePos(e);
    if (this.callbacks.onMouseUp) this.callbacks.onMouseUp(pos);
  }

  _handleClick(e) {
    const pos = this.getMousePos(e);
    if (this.callbacks.onClick) this.callbacks.onClick(pos);
  }

  _handleRightClick(e) {
    if (this.callbacks.onRightClick) this.callbacks.onRightClick();
  }

  destroy() {
    this.canvas.removeEventListener('mousedown', this._handleMouseDown);
    this.canvas.removeEventListener('mousemove', this._handleMouseMove);
    this.canvas.removeEventListener('mouseup', this._handleMouseUp);
    this.canvas.removeEventListener('click', this._handleClick);
    this.canvas.removeEventListener('contextmenu', this._handleRightClick);
  }
}

export { InputHandler };
