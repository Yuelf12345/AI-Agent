/**
 * 给定一个正整数数组 nums 和一个目标正整数 target ，请找出所有可能的组合，使得组合中的元素和等于 target 。给定数组无重复元素，每个元素可以被选取多次。请以列表形式返回这些组合，列表中不应包含重复组合。
 * 例如，输入nums =[3,4,5] target = 9
    return [[3,3,3],[4,5]]
 */
function combinationSum(nums, target) {
  const res = [];
  const path = [];
  nums.sort((a, b) => a - b);
  function backstrack(start) {
    const sum = path.reduce((a, b) => a + b, 0);
    if (sum === target) {
      res.push([...path]);
      return;
    }
    for (let i = start; i < nums.length; i++) {
      if (sum + nums[i] <= target) {
        path.push(nums[i]);
        backstrack(i);
        path.pop();
      }
    }
  }
  backstrack(0);
  return res;
}
console.log(combinationSum([3, 4, 5], 9));
