// @ts-ignore
import { setTimeout, clearTimeout, setInterval, clearImmediate } from "timers-browserify";
function _setTimeout(cb: (...args: any[]) => void, ms: number, ...args: any[]) {
  let ret: any = null;
  const _reusableTimer = () => {
    if (ret !== null) clearTimeout(ret);
    ret = setTimeout(cb, ms, ...args);
    return Object.defineProperty(ret, "refresh", {
      enumerable: false,
      value: _reusableTimer,
    });
  };
  return _reusableTimer();
}
export { _setTimeout as setTimeout, clearTimeout, setInterval, clearImmediate };
