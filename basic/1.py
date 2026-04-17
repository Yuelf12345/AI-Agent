# 1. 合法命名
##1.1 正确
age = 25
user_name = "张三"
_height = 175
WEIGHT = 75
# calculate_area() 
StudentInfo = "学生信息"
__hobby = "读书"
"""
##1.2 错误
2nd_place = "silver"    # 错误:以数字开头
# user-name = "Bob"       # 错误:包含连字符
# class = "Math"          # 错误:使用关键字
# $price = 9.99          # 错误:包含特殊字符
# for = "loop"           # 错误:使用关键字
"""
### 1.3 校验函数
def is_valid_identifier(name):
    try:
        exec(f"{name} = None")
        return True
    except:
        return False

print(is_valid_identifier("2var"))  # False
print(is_valid_identifier("var2"))  # True

# 2. 数据类型
"""
## 2.1 Python3 中常见的数据类型有:
Number(数字) // int float bool complex(复数)。
String(字符串)
bool(布尔类型)  // 0、空字符串、空列表、空元组等被视为 False
List(列表)
Tuple(元组) //  ('abcd', 786 , 2.23, 'runoob', 70.2  ) 元组的元素不能修改
Set(集合)
Dictionary(字典)

Python3 的六个标准数据类型中:
不可变数据(3 个):Number(数字)、String(字符串)、Tuple(元组);
可变数据(3 个):List(列表)、Dictionary(字典)、Set(集合)。
"""

# 2.2 类型判断
print(type(1))        # <class 'int'>
print(type(0.5))        # <class 'float'>
print(type("zs"))     # <class 'str'>
print(type(True)) # <class 'bool'>
a, b, c, d = 20, 5.5, True, 4+3j
print(type(a), type(b), type(c), type(d)) # <class 'int'> <class 'float'> <class 'bool'> <class 'complex'>
print(isinstance(a, int))


class Animal:
    pass

class Dog(Animal):
    pass

dog = Dog()
# isinstance 会检查继承链
isinstance(dog, Dog)      # True
isinstance(dog, Animal)   # True (支持继承)
# type 只返回确切类型
type(dog) == Dog          # True
type(dog) == Animal       # False (不考虑继承)