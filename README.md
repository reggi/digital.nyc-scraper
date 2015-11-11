# digital.nyc Scraper

I'm interested in scraping all of the companies listed in the "Made in New York" directory now called `digital.nyc` located here [http://www.digital.nyc/startups](http://www.digital.nyc/startups).

What I really want to find is a list of companies based in New York using the Shopify e-commerce platform. To achieve this there needs to be a couple of difference steps.

I need to get all of the startups listed into a database. Each startup has a `name` and a `profile` on the `digital.nyc` website. With the full list of profile pages I can scrape the page and look for the companies `website`.

This project uses Redis to cache each webpage so that I ever only hit any server for a specific endpoint. If I fetch the page again I pull my own cached version in Redis instead of the live one. This project uses CouchDB / PouchDB for storing the individual company information.
