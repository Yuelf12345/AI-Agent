# 多变量线性回归 - 房屋价格预测
# 使用三个特征：面积、楼层、房龄
# 目标：预测房价 price = w1 * area + w2 * floor + w3 * age + b

import numpy as np

# ============================================
# 第一步：准备训练数据
# ============================================
# 假设真实关系是: price = 50 * area + 10 * floor - 5 * age + 100 (加上噪声)
# area(面积): 50-150 平方米
# floor(楼层): 1-30 层
# age(房龄): 0-20 年

np.random.seed(42)  # 固定随机种子，保证结果可复现

# 生成 100 个房屋样本
m = 100  # 样本数量

# 特征矩阵 X: 每行是一个样本，每列是一个特征
area = np.random.rand(m) * 100 + 50  # 面积: 50-150 平米
floor = np.random.rand(m) * 29 + 1   # 楼层: 1-30 层
age = np.random.rand(m) * 20         # 房龄: 0-20 年

X = np.column_stack([area, floor, age])  # 合并为矩阵 (200, 3)

# 真实参数
w_true = np.array([50, 10, -5])  # 真实权重 [面积系数, 楼层系数, 房龄系数]
b_true = 100                      # 真实偏置

# 生成标签(房价): 加上随机噪声
Y = X @ w_true + b_true + np.random.randn(m) * 50  # @ 是矩阵乘法

print("=" * 60)
print("房屋价格预测 - 多变量线性回归")
print("=" * 60)
print(f"数据集大小: {m} 个房屋样本")
print(f"特征维度: {X.shape[1]} (面积、楼层、房龄)")
print(f"\n特征范围:")
print(f"  面积: [{area.min():.1f}, {area.max():.1f}] 平米")
print(f"  楼层: [{floor.min():.1f}, {floor.max():.1f}] 层")
print(f"  房龄: [{age.min():.1f}, {age.max():.1f}] 年")
print(f"  房价: [{Y.min():.1f}, {Y.max():.1f}] 万元")
print(f"\n真实模型参数:")
print(f"  面积系数: {w_true[0]:.1f} 万元/平米")
print(f"  楼层系数: {w_true[1]:.1f} 万元/层")
print(f"  房龄系数: {w_true[2]:.1f} 万元/年 (负值表示越老越便宜)")
print(f"  基础价格: {b_true:.1f} 万元")

# ============================================
# 第二步：特征标准化 (Feature Normalization)
# ============================================
# 由于三个特征的量纲不同，需要标准化处理
# 标准化公式: x_norm = (x - mean) / std

X_mean = X.mean(axis=0)  # 每列的均值
X_std = X.std(axis=0)    # 每列的标准差
X_norm = (X - X_mean) / X_std  # 标准化后的特征

print(f"\n特征标准化:")
print(f"  面积均值: {X_mean[0]:.1f}, 标准差: {X_std[0]:.1f}")
print(f"  楼层均值: {X_mean[1]:.1f}, 标准差: {X_std[1]:.1f}")
print(f"  房龄均值: {X_mean[2]:.1f}, 标准差: {X_std[2]:.1f}")

# ============================================
# 第三步：初始化参数
# ============================================
n = X.shape[1]  # 特征数量 = 3
w = np.zeros(n)  # 权重向量初始化为 [0, 0, 0]
b = 0.0          # 偏置初始化为 0

learning_rate = 0.1  # 学习率(标准化后可以用更大的学习率)
iterations = 1000    # 迭代次数

print(f"\n初始参数: w={w}, b={b:.2f}")
print(f"学习率: {learning_rate}, 迭代次数: {iterations}")

# ============================================
# 第四步：定义损失函数
# ============================================
def compute_cost(X, Y, w, b):
    """
    计算多变量线性回归的均方误差损失
    
    公式: J(w,b) = 1/(2m) × Σ(预测值 - 真实值)²
    向量化形式: J(w,b) = 1/(2m) × ||X@w + b - Y||²
    
    参数:
        X: 特征矩阵 (m, n)
        Y: 真实标签 (m,)
        w: 权重向量 (n,)
        b: 偏置
    
    返回:
        cost: 损失值
    """
    m = len(X)
    predictions = X @ w + b  # 矩阵乘法: (m,n) @ (n,) = (m,)
    errors = predictions - Y
    cost = np.sum(errors ** 2) / (2 * m)
    return cost

# ============================================
# 第五步：计算梯度
# ============================================
def compute_gradient(X, Y, w, b):
    """
    计算损失函数对 w 和 b 的梯度
    
    公式:
        ∂J/∂w = 1/m × X^T @ (X@w + b - Y)
        ∂J/∂b = 1/m × Σ(预测值 - 真实值)
    
    参数:
        X: 特征矩阵 (m, n)
        Y: 真实标签 (m,)
        w: 权重向量 (n,)
        b: 偏置
    
    返回:
        dw: w 的梯度向量 (n,)
        db: b 的梯度
    """
    m = len(X)
    predictions = X @ w + b
    errors = predictions - Y
    
    dw = (X.T @ errors) / m  # (n,m) @ (m,) = (n,)
    db = np.sum(errors) / m
    
    return dw, db

# ============================================
# 第六步：梯度下降训练
# ============================================
print("\n" + "=" * 60)
print("开始训练...")
print("=" * 60)

cost_history = []

for i in range(iterations):
    # 计算当前损失
    cost = compute_cost(X_norm, Y, w, b)
    cost_history.append(cost)
    
    # 计算梯度
    dw, db = compute_gradient(X_norm, Y, w, b)
    
    # 更新参数
    w = w - learning_rate * dw
    b = b - learning_rate * db
    
    # 每 100 次迭代打印进度
    if (i + 1) % 100 == 0:
        print(f"迭代 {i+1:4d}/{iterations} - 损失: {cost:10.2f}")

# ============================================
# 第七步：输出训练结果
# ============================================
print("\n" + "=" * 60)
print("训练完成!")
print("=" * 60)
print(f"最终损失: {cost_history[-1]:.2f}")
print(f"\n学到的参数(标准化空间):")
print(f"  w = {w}")
print(f"  b = {b:.2f}")

# 将权重转换回原始空间
w_original = w / X_std
b_original = b - np.sum(w_original * X_mean)

print(f"\n学到的参数(原始空间):")
print(f"  面积系数: {w_original[0]:6.2f} 万元/平米 (真实值: {w_true[0]:.2f})")
print(f"  楼层系数: {w_original[1]:6.2f} 万元/层   (真实值: {w_true[1]:.2f})")
print(f"  房龄系数: {w_original[2]:6.2f} 万元/年   (真实值: {w_true[2]:.2f})")
print(f"  基础价格: {b_original:6.2f} 万元       (真实值: {b_true:.2f})")

# ============================================
# 第八步：测试预测
# ============================================
print("\n" + "=" * 60)
print("测试预测:")
print("=" * 60)

# 测试几个样本
test_cases = [
    [80, 10, 5],   # 80平米, 10层, 5年房龄
    [100, 20, 2],  # 100平米, 20层, 2年房龄
    [120, 15, 10], # 120平米, 15层, 10年房龄
]

print(f"{'面积':>6} {'楼层':>6} {'房龄':>6}  ->  {'预测房价':>8}  {'真实房价':>8}  {'误差':>6}")
print("-" * 60)

for test_case in test_cases:
    area_test, floor_test, age_test = test_case
    
    # 使用原始空间的参数预测
    price_pred = (w_original[0] * area_test + 
                  w_original[1] * floor_test + 
                  w_original[2] * age_test + 
                  b_original)
    
    # 真实价格(用真实参数计算)
    price_true = (w_true[0] * area_test + 
                  w_true[1] * floor_test + 
                  w_true[2] * age_test + 
                  b_true)
    
    error = abs(price_pred - price_true)
    
    print(f"{area_test:6.0f} {floor_test:6.0f} {age_test:6.0f}  ->  "
          f"{price_pred:8.1f}  {price_true:8.1f}  {error:6.1f}")

# ============================================
# 第九步：交互式预测
# ============================================
print("\n" + "=" * 60)
print("交互式预测 (输入房屋信息预测价格)")
print("=" * 60)
print("提示: 使用学到的模型参数预测任意房屋的价格")
print(f"公式: 房价 = {w_original[0]:.2f} × 面积 + {w_original[1]:.2f} × 楼层 + {w_original[2]:.2f} × 房龄 + {b_original:.2f}")
print("\n示例调用:")
print(f"  predict_price(area=90, floor=12, age=3) = {w_original[0]*90 + w_original[1]*12 + w_original[2]*3 + b_original:.1f} 万元")

def predict_price(area, floor, age):
    """使用训练好的模型预测房价"""
    price = w_original[0] * area + w_original[1] * floor + w_original[2] * age + b_original
    return price

# 导出预测函数供外部使用
__all__ = ['predict_price', 'w_original', 'b_original']
