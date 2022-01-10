import { Map as YMap, Array as YArray } from 'yjs';
import { getDiff } from 'recursive-diff';
import { clamp, isInteger, isString } from './utlis';
import { valueToYValue } from './valueToYValue';
import { RecursiveDiffResult, RecursiveDiffResultOperation } from './recursive-diff';

/** @desc Handles the operation from recursive-diff to patch the given yType */
const patchYType = (
  yType: YMap<unknown> | YArray<unknown>,
  operation: RecursiveDiffResultOperation,
  property: string | number, // Either the Map key or Array index
  value: unknown
) => {
  if (
    operation === RecursiveDiffResultOperation.Add ||
    operation === RecursiveDiffResultOperation.Update
  ) {
    const yValue = valueToYValue(value);

    if (yType instanceof YArray && isInteger(property)) {
      if (operation === RecursiveDiffResultOperation.Update) yType.delete(property);

      yType.insert(property, [yValue]);
    } else if (yType instanceof YMap && isString(property)) {
      yType.set(property, yValue);
    } else {
      throw new Error('Unsupported YAbstractType or property type did not match.');
    }
  } else if (operation === RecursiveDiffResultOperation.Delete) {
    if (yType instanceof YArray && isInteger(property)) {
      // This actually only works because the "recursive-diff" turns [1, 2, 3] => [3] into [{op: 'update', index: 0, val: 3}, {op: 'del', index: 1}, {op: 'del', index: 2}]
      // Therefore delete operations are always last. A more sophisticated solution would group deletions together to a single operation.
      const clampedIndex = clamp(property, 0, yType.length - 1);
      yType.delete(clampedIndex);
    } else if (yType instanceof YMap && isString(property)) {
      yType.delete(property);
    } else {
      throw new Error('Unsupported YAbstractType or property type did not match.');
    }
  }
};

/** @desc Recursively walk through path array until its length is one, at which point it performs the appropriate operation on the remaining property in the path. */
const traversePath = (
  yType: YMap<unknown> | YArray<unknown>,
  operation: RecursiveDiffResultOperation,
  path: Array<string | number>,
  value: unknown
) => {
  if (path.length === 0) {
    throw new Error('Cannot traverse 0 length path.');
  }

  if (path.length === 1) {
    patchYType(yType, operation, path[0], value);
  } else {
    const [currentSegment, ...restPath] = path;

    if (yType instanceof YArray) {
      if (!isInteger(currentSegment)) {
        throw new Error('States diverged.');
      }

      const nextType = yType.get(currentSegment);

      // NextType must also be an array or map because path.length >= 2.
      if (!(nextType instanceof YMap || nextType instanceof YArray)) {
        throw new Error('States diverged.');
      }

      traversePath(nextType, operation, restPath, value);
    } else if (yType instanceof YMap) {
      if (!isString(currentSegment)) {
        throw new Error('States diverged.');
      }

      const nextType = yType.get(currentSegment);

      // NextType must also be an array or map because path.length >= 2.
      if (!(nextType instanceof YMap || nextType instanceof YArray)) {
        throw new Error('States diverged.');
      }

      traversePath(nextType, operation, restPath, value);
    } else {
      console.warn('Encountered unsupported yType. Received:', yType);
    }
  }
};

/**
 * @desc Takes a rootMap that holds the values at the given sliceName. Then compares the old and new state to find the difference and apply that to the slice in the rootMap.
 * @param rootMap The yMap that holds the values to all slices.
 * @param sliceName Property name that contains the values on the rootMap.
 * @param a The old value.
 * @param b The new value.
 * */
export const patchYjs = (rootMap: YMap<unknown>, sliceName: string, a: unknown, b: unknown) => {
  // Types of getDiff are inaccurate
  const diff = getDiff(a, b) as RecursiveDiffResult;

  // Applying diff in reverse to avoid problems when removing more than one item from an array,
  // where the index of the item that should be removed moves after a previous one was removed.
  // F.e.: diff(1[, 2], []) returns [{op: 'del', idx: 0}, {op: 'del', idx: 1}] but by the time
  // we try to remove the second element, the array only has a length of 1. Thus index 1 would
  // be out of bounds. Deleting from right to left circumvents this problem, while introducing
  // it again but for insertions. To solve this problem, items should be inserted from left to
  // right but removed right to left. A workaround exists inside the patchYType function, that
  // simply clamps the accessed index to the length of the array. The method is limited to the
  // recursive-diff algorithm though.
  // diff.reverse(); // Won't work for multiple consecutive insertions.

  diff.forEach(({ op, path, val }) => {
    // "path" is undefined if a or b are primitive values.
    traversePath(rootMap, op, [sliceName, ...(path || [])], val);
  });
};
