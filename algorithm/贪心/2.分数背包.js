/**
 * 给定n个物品，第i个物品的重量为wgt[i]、价值为val[i]，和一个容量为cap的背包。每个物品只能选择一次，但可以选择物品的一部分，价值根据选择的重量比例计算，问在限定背包容量下背包中物品的最大价值.
 */
function fractionalKnapsack(capacity, weights, values) {
    let res = 0;
    const arr = [];
    for (let i = 0; i < weights.length; i++) {
        arr.push({ weight: weights[i], value: values[i], ratio: values[i] / weights[i] });
    }
    arr.sort((a, b) => b.ratio - a.ratio);
    for(let i = 0;i<arr.length;i++){
        if(capacity >= arr[i].weight){
            capacity -= arr[i].weight;
            res += arr[i].value;
        }else{
            res += arr[i].ratio * capacity;
            break;
        }
    }
    return res;
}
console.log(fractionalKnapsack(50, [10, 20, 30, 40, 50], [50, 120, 150, 210, 240])); // 输出: 277.5

// 5, 6, 5, 5.25, 4.8

/* 物品 */
class Item {
    constructor(w, v) {
        this.w = w; // 物品重量
        this.v = v; // 物品价值
    }
}

/* 分数背包：贪心 */
function fractionalKnapsack(wgt, val, cap) {
    // 创建物品列表，包含两个属性：重量、价值
    const items = wgt.map((w, i) => new Item(w, val[i]));
    // 按照单位价值 item.v / item.w 从高到低进行排序
    items.sort((a, b) => b.v / b.w - a.v / a.w);
    // 循环贪心选择
    let res = 0;
    for (const item of items) {
        if (item.w <= cap) {
            // 若剩余容量充足，则将当前物品整个装进背包
            res += item.v;
            cap -= item.w;
        } else {
            // 若剩余容量不足，则将当前物品的一部分装进背包
            res += (item.v / item.w) * cap;
            // 已无剩余容量，因此跳出循环
            break;
        }
    }
    return res;
}