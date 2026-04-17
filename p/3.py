
# ========== 练习9：模块导入 ==========
print("\n=== 练习9：导入其他模块 ===")
# 方法1：直接导入模块
import p_2
result1 = p_2.add(10, 20)
print(f"使用 import p_2: 10 + 20 = {result1}")

# 方法2：从模块导入特定函数
from p_2 import add
result2 = add(30, 40)
print(f"使用 from p_2 import add: 30 + 40 = {result2}")

# 方法3：使用别名导入
from p_2 import add as my_add
result3 = my_add(50, 60)
print(f"使用 from p_2 import add as my_add: 50 + 60 = {result3}")
