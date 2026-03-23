files = ["index.html", "404.html"]
urls = File.readlines("/tmp/shot_external_urls.txt", chomp: true)

files.each do |file|
  text = File.binread(file)

  urls.each do |url|
    replacement = case url
    when %r{\Ahttps://image2url\.com/}
      "images/mlwpbw1duqawjlhhun3dbwpgjak.mp4"
        when %r{\Ahttps://framerusercontent\.com/images/},
          %r{\Ahttps://framerusercontent\.com/sites/},
          %r{\Ahttps://framerusercontent\.com/assets/},
         %r{\Ahttps://fonts\.gstatic\.com/s/fragmentmono/}
      uri = url.sub(%r{\Ahttps://}, "")
      uri = uri.sub(/\?.*\z/, "")
      "external/#{uri}"
    else
      nil
    end

    next unless replacement

    text.gsub!(url, replacement)
    text.gsub!(url.gsub("&", "&amp;"), replacement)
  end

  text.gsub!(%r{<meta name="framer-search-index"[^>]*>\s*}, "")
  text.gsub!(%r{<meta name="framer-search-index-fallback"[^>]*>\s*}, "")
  text.gsub!(%r{<link href="https://fonts\.gstatic\.com" rel="preconnect" crossorigin>\s*}, "")

  File.binwrite(file, text)
end
