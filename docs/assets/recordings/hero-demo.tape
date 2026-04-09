# Hero Demo: Zero to Dataset
# Records a complete scrape -> transform -> format workflow
# Usage: vhs docs/assets/recordings/hero-demo.tape

Output docs/assets/recordings/hero-demo.gif
Set Theme "Dracula"
Set FontSize 14
Set Width 900
Set Height 500
Set Padding 20

# Title
Type "# Zero to Dataset: Scrape, Transform, Format"
Enter
Sleep 500ms

# Step 1: Scrape images from the web
Type "# Step 1: Scrape images of cats from the web"
Enter
Sleep 500ms
Type "npm start -- scrape --search 'cats' --download --formats image --search-count 5"
Enter
Sleep 8s

# Step 2: Transform to training data
Type "# Step 2: Transform to training data"
Enter
Sleep 500ms
Type "npm start -- transform -i output/task_xxx -t image-classification --target 'cats'"
Enter
Sleep 5s

# Step 3: Format for ML training
Type "# Step 3: Format for ML training"
Enter
Sleep 500ms
Type "npm start -- format -i classified.json -f imagefolder -o dataset/"
Enter
Sleep 3s

# Done
Type "# Dataset ready for training!"
Enter
Sleep 2s
