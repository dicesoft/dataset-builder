---
layout: default
title: Home
nav_order: 1
---

# dataset-builder

CLI tool for building ML/LLM datasets via scraping, synthetic generation, importing, cleaning, formatting, and transformation.

## Quick Start

```bash
# Install
git clone https://github.com/3koozy/dataset-builder.git
cd dataset-builder && npm install

# Scrape and download images
npm start -- scrape --search "AI research" --download --formats image

# Transform to training data
npm start -- transform -i output/task_xxx -t text-qa --target "AI research"

# Format for training
npm start -- format -i dataset.json -f alpaca -o output/
```

## Features

- **Web Scraping** with 17+ search providers (no API keys required)
- **Synthetic Data** generation with Faker and Ollama LLM
- **Data Transformation** using LLM/Vision models (Q&A, captioning, object detection)
- **16 Output Formats** including Alpaca, ChatML, ShareGPT, COCO, YOLO
- **Dataset Translation** into 29 languages
- **Data Cleaning** with deduplication, vision filtering, and math verification

[View on GitHub](https://github.com/3koozy/dataset-builder){: .btn .btn-primary }
