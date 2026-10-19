/**
 * 给定一个长度为n的有序数组 nums ，其中所有元素都是唯一的，请查找元素 target 。
 */
function dfs(nums, target, left, right) {
    if (left > right) return -1;
    let mid = Math.floor((left + (right - left) / 2))
    if (nums[mid] === target) return mid;
    if (nums[mid] > target) return dfs(nums, target, left, mid - 1)
    if (nums[mid] < target) return dfs(nums, target, mid + 1, right)

}
function seek(nums, target) {
    const len = nums.length;
    return dfs(nums, target, 0, len - 1)
}
function seekLoop(nums, target) {
    let l = 0; r = nums.length - 1
    while(l <= r){
        const mid = Math.floor((l + (r - l) / 2))
        if(nums[mid] === target) return mid
        if(nums[mid] > target) r = mid - 1
        if(nums[mid] < target) l = mid + 1
    }
    return -1
}
console.log(seek([1, 3, 5, 6, 7, 8], 6));
console.log(seekLoop([1, 3, 5, 6, 7, 8], 6));
