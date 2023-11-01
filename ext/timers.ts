// @ts-ignore
import { setTimeout, clearTimeout, setInterval, clearImmediate } from "timers-browserify";
function _setTimeout(cb: (...args: any[]) => void, ms: number, ...args: any[]) {
  let ret = setTimeout(cb, ms, ...args);
  const refresh = () => {
    clearTimeout(ret);
    ret = setTimeout(cb, ms, ...args);
    // @ts-ignore
    ret.refresh = refresh;
    return ret;
  };
  // @ts-ignore
  ret.refresh = refresh;
  return ret;
}
export { _setTimeout as setTimeout, clearTimeout, setInterval, clearImmediate };
