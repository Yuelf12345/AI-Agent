// <!-- 1.   这段排列算法会漏掉结果吗¶
// 一个回溯算法按 1、2、3 的顺序尝试生成全部排列。每次选择数字 x 时，它会：

// 把 x 加到当前路径末尾；
// 把 x 标记为“已使用”；
// 递归填写下一个位置。
// 递归返回后，同学只从路径末尾删除了 x，然后继续尝试下一个数字。

// 算法首先得到哪个排列？它还能得到全部 6 个排列吗？
// 递归返回上一层前，只删除路径末尾的数字是否足够？如果不够，还需要做什么？说明理由。
// 2.   数字的选择顺序重要吗¶
// 给定排好序的数组 [2, 3, 5] 和目标值 5，每个数可以重复选择。 算法规定每条搜索路径中的数字只能按从小到大的顺序出现。

// 能得到哪些不同的组合？
// 为什么同一组数字不需要按不同顺序重复搜索？“从小到大”的限制起到了什么作用？
// 当前路径为 [3]、还差 2 时，下一个候选数是 3。为什么此时可以停止检查这一层后面的所有候选数

// 整数数组 nums 至少包含一个元素，并且其中各元素互不相同。 请列出把这些元素各使用一次所能形成的全部顺序，并将每一种顺序作为一个数组返回。 结果中各排列的先后次序不作要求。 请使用回溯，并用布尔数组记录每个位置的元素是否已经选入当前排列。 -->


/**
 * 给定一个共有n阶的楼梯，你每步可以上1阶或者2阶，请问有多少种方案可以爬到楼顶？
 */
function climbStairs(n) {
    let count = 0;
    function backtrack(curr) {
        if(curr === n) {
            count++;
            return;
        }
        if(curr > n) {
            return;
        }
        backtrack(curr + 1);
        backtrack(curr + 2);
    }
    backtrack(0);
    return count;
}
console.log(climbStairs(4)); // 5

/**整数数组 nums 至少包含一个元素，并且其中各元素互不相同。 请列出把这些元素各使用一次所能形成的全部顺序，并将每一种顺序作为一个数组返回。 结果中各排列的先后次序不作要求。 请使用回溯，并用布尔数组记录每个位置的元素是否已经选入当前排列。 */
var permute = function (nums) {
    if (nums.length === 0) return [];
    const res = [];
    const path = [];
    function backtrack(path) {
        if (path.length === nums.length) {
            res.push([...path]);
            return;
        }
        for (let i = 0; i < nums.length; i++) {
            if (path.includes(nums[i])) continue;
            path.push(nums[i]);
            backtrack(path);
            path.pop();
        }
    }
    backtrack([]);
    return res;
};
console.log(permute([1, 2, 3]));