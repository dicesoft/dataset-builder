# Pipeline Demo: Scrape + Transform + Format
# Shows the full pipeline workflow with text data
# Usage: vhs docs/assets/recordings/pipeline-demo.tape

Output docs/assets/recordings/pipeline-demo.gif
Set Theme "Dracula"
Set FontSize 14
Set Width 900
Set Height 500
Set Padding 20

# Title
Type "# Pipeline Demo: Scrape + Transform + Format"
Enter
Sleep 500ms

# Step 1: Scrape articles about machine learning
Type "# Step 1: Scrape articles about machine learning"
Enter
Sleep 500ms
Type "npm start -- scrape --search 'machine learning tutorials' --search-count 10 --download"
Enter
Sleep 8s

# Step 2: Transform scraped content into Q&A pairs
Type "# Step 2: Transform into Q&A pairs using LLM"
Enter
Sleep 500ms
Type "npm start -- transform -i output/task_xxx -t question-answer"
Enter
Sleep 6s

# Step 3: Format as Alpaca training data
Type "# Step 3: Format as Alpaca training data"
Enter
Sleep 500ms
Type "npm start -- format -i transformed.json -f alpaca -o dataset/ml-qa"
Enter
Sleep 3s

# Step 4: Show the result
Type "# Step 4: Preview the dataset"
Enter
Sleep 500ms
Type "head -n 20 dataset/ml-qa/train.json"
Enter
Sleep 3s

# Done
Type "# Pipeline complete - dataset ready for fine-tuning!"
Enter
Sleep 2s
