/**
 * 全局路径常量
 *
 * 统一管理 RAG 系统的所有路径配置
 * 所有 RAG 文件（Naive/Multimodal/Agentic 等）共享同一套基础路径
 *
 * 目录结构：
 *   llamaIndex/
 *   ├── files/              ← FILE_DIR（文档数据源）
 *   │   ├── images/         ← IMAGE_DIR（图片数据源）
 *   │   └── pdf/            ← PDF 文件
 *   ├── storage/            ← STORAGE_DIR（Naive RAG 索引持久化）
 *   ├── storage_multimodal/ ← STORAGE_MULTIMODAL_DIR（Multimodal RAG 索引持久化）
 *   └── cache/              ← CACHE_DIR（缓存目录）
 *       ├── naive_nodes.json      ← CACHE_NAIVE（Naive RAG 切分缓存）
 *       ├── multimodal_nodes.json ← CACHE_MULTIMODAL（Multimodal RAG 切分缓存）
 *       └── image_descriptions.json ← CACHE_IMAGE_DESC（图片描述缓存）
 */

import path from "path";
import { fileURLToPath } from "url";

// ─── 基础路径 ────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ─── 数据源路径 ─────────────────────────────────────────────────────
/** 文件数据目录（PDF、Markdown 等） */
export const FILE_DIR = path.resolve(PROJECT_ROOT, "files");

/** 图片数据目录 */
export const IMAGE_DIR = path.resolve(FILE_DIR, "images");

// ─── 持久化存储路径 ──────────────────────────────────────────────────
/** Naive RAG 索引持久化目录 */
export const STORAGE_DIR = path.resolve(PROJECT_ROOT, "storage");

/** Multimodal RAG 索引持久化目录 */
export const STORAGE_MULTIMODAL_DIR = path.resolve(PROJECT_ROOT, "storage_multimodal");

// ─── 缓存路径 ────────────────────────────────────────────────────────
/** 缓存根目录 */
export const CACHE_DIR = path.resolve(PROJECT_ROOT, "cache");

/** Naive RAG 切分结果缓存 */
export const CACHE_NAIVE = path.resolve(CACHE_DIR, "naive_nodes.json");

/** Multimodal RAG 切分结果缓存 */
export const CACHE_MULTIMODAL = path.resolve(CACHE_DIR, "multimodal_nodes.json");

/** Vision LLM 生成的图片描述缓存 */
export const CACHE_IMAGE_DESC = path.resolve(CACHE_DIR, "image_descriptions.json");
