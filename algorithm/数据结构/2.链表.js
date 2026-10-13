class ListNode {
  constructor(val, next) {
    this.val = val === undefined ? 0 : val;
    this.next = next === undefined ? null : next;
  }
}
const n1 = new ListNode(1);
const n2 = new ListNode(2);
const n3 = new ListNode(3);
const n4 = new ListNode(4);

n1.next = n2;
n2.next = n3;
n3.next = n4;

console.log(n1);

// 插入节点
function insert(head, val) {
  const n = head.next;
  head.next = val;
  val.next = n;
  return head;
}
// console.log("insert",insert(n1, new ListNode('insert')));
// 删除节点
function del(head) {
  const n = head.next;
  head.next = n.next;
  return head;
}
// console.log("delete",del(n1));
// 访问节点
function findIndex(head, index) {
  let n = head;
  for (let i = 0; i < index; i++) {
    n = n.next;
  }
  return n;
}
// console.log("findIndex", findIndex(n1, 2));
//  查找节点
function find(head, val) {
  let index = 0;
  while (head) {
    if (head.val === val) return index;
    index++;
    head = head.next;
  }
  return -1;
}
// console.log("find", find(n1, 3));

// 反转链表
function reverse(head) {
  let cur = null;
  let next = head;
  while (next) {
    const temp = next.next;
    next.next = cur;
    cur = next;
    next = temp;
  }
  return cur;
}

console.log("reverse", reverse(n1));
