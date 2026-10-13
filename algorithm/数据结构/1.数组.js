// 初始化数组
const arr = new Array(5).fill(0);
console.log(arr);

// 访问元素 arr[i]
// 插入元素
function insert(arr, index, value) {
  // arr.splice(index,0,value)
  // return arr
  for (let i = arr.length - 1; i > index; i--) {
    console.log("==", i);
    arr[i] = arr[i - 1];
  }
  arr[index] = value;
  return arr;
}
console.log(insert([1, 2, 3, 4, 5, 6, 7], 2, 4));

// 删除元素
function del(arr, index) {
  // arr.splice(index,1)
  // return arr
  for (let i = index; i < arr.length - 1; i++) {
    arr[i] = arr[i + 1];
  }
  return arr;
}
console.log(del([1, 2, 3, 4, 5, 6, 7], 2));
