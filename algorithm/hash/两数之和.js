
nums = [2,7,11,15,22,10], target = 25
var twoSum = function(nums, target) {
    const map = new Map()
    for(let i=0;i<=nums.length;i++){
        if(map.has(target-nums[i])){
            return [map.get(target-nums[i]),i]
        }else{
            map.set(nums[i],i)
        }
        console.log(map);
    }
};

console.log(twoSum(nums,target));