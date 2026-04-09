# Scrapy settings for dataset-builder

BOT_NAME = "dataset_builder"

SPIDER_MODULES = ["dataset_builder.spiders"]
NEWSPIDER_MODULE = "dataset_builder.spiders"

ROBOTSTXT_OBEY = False

USER_AGENT = "dataset-builder/0.1.0 (https://github.com/dataset-builder)"

CONCURRENT_REQUESTS = 16
DOWNLOAD_DELAY = 0.5

TELNETCONSOLE_ENABLED = False

REQUEST_FINGERPRINTER_IMPLEMENTATION = "2.7"
TWISTED_REACTOR = "twisted.internet.asyncioreactor.AsyncioSelectorReactor"
FEED_EXPORT_ENCODING = "utf-8"

# Output formats
FEED_EXPORTERS = {
    'json': 'scrapy.exporters.JsonItemExporter',
    'jsonl': 'scrapy.exporters.JsonLinesItemExporter',
    'csv': 'scrapy.exporters.CsvItemExporter',
    'xml': 'scrapy.exporters.XmlItemExporter',
}

# Depth settings
DEPTH_LIMIT = 3
DEPTH_PRIORITY = 1
DEPTH_STATS_VERBOSE = True
