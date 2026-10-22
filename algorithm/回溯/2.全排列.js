/**
 * 输入一个整数数组，其中不包含重复元素，返回所有可能的排列。
 */
function permutationsI(nums) {
  const result = [];
  const path = [];
  function backtrack(path) {
    if (path.length === nums.length) {
      result.push([...path]);
      return;
    }
    for (let i = 0; i < nums.length; i++) {
      if (path.includes(nums[i])) continue;
      path.push(nums[i]);
      backtrack(path);
      path.pop();
    }
  }
  backtrack(path);
  return result;
}
// console.log(permutationsI([1, 2, 3]));

/**
 * 输入一个整数数组，数组中可能包含重复元素，返回所有不重复的排列。
 */
function permutationsII(nums) {
  const result = [];
  const path = [];
  const used = new Array(nums.length).fill(false);
  nums.sort((a, b) => a - b);
  function backtrack(path) {
    if (path.length === nums.length) {
      result.push([...path]);
      return;
    }
    for (let i = 0; i < nums.length; i++) {
        if(used[i]) continue;
        // 如果当前元素和前一个元素相同，并且前一个元素还没有被使用过，则跳过当前元素，避免重复排列
        if(i > 0 && nums[i] === nums[i - 1] && !used[i - 1]) continue;
        path.push(nums[i]);
        used[i] = true;
        backtrack(path);
        path.pop();
        used[i] = false;

    }
  }
  backtrack(path);
  return result;
}
// console.log(permutationsII([1, 1, 2]));
