#!/bin/bash
UA="ExhibitB-benchmark-research/0.1 (+contact: 20012001amiramir@gmail.com)"
q="$1"; out="$2"
curl -s -A "$UA" --get "https://www.courtlistener.com/api/rest/v4/search/" \
  --data-urlencode "q=$q" --data-urlencode "type=o" --data-urlencode "order_by=dateFiled desc" > "$out"
