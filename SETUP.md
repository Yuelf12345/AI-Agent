# 环境配置指南

## 🐍 Python环境
```bash
# 创建虚拟环境
python -m venv learn_env
source learn_env/bin/activate  # Mac/Linux
# learn_env\Scripts\activate   # Windows

# 安装TensorFlow
pip install tensorflow

# 安装其他依赖
pip install numpy matplotlib

# 验证安装
python -c "import tensorflow as tf; print('TensorFlow版本:', tf.__version__)"
```

## 🚀 快速启动
```bash
cd /Users/yuelongfang/Desktop/demo/learn
python mnist_tensorflow.py
```

## 🌐 使用Google Colab
1. 打开 https://colab.research.google.com/
2. 上传 `mnist_tensorflow.py` 文件
3. 点击左侧三角形运行
4. 查看输出结果

## 📊 查看结果
- **模型文件**: `mnist_model.h5`
- **图表文件**: `training_history.png`
- **控制台输出**: 训练进度和准确率

## 🔧 常见问题

### 1. TensorFlow安装失败
```bash
# 换用CPU版本
pip install tensorflow-cpu

# 或使用Colab (已预装)
```

### 2. 显存不足
```bash
# 在Colab上运行
# 或减少batch_size
batch_size=64
```

### 3. 运行超时
```bash
# 使用Colab Pro
# 或分段运行代码
```

## 📚 学习资源
- TensorFlow官方文档: https://www.tensorflow.org/
- Keras文档: https://keras.io/
- MNIST数据集: http://yann.lecun.com/exdb/mnist/