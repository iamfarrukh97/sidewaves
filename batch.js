    const async = require("async");
    var q = async.queue((item, callback) => {
      setTimeout(async () => {
        const response = await geocoder.geocode(item.address);
        if (response[0]) {
          const info = response[0];
          if (info.countryCode) {
          }
          geoAnalysis.push(getCountryISO3(info.countryCode));
          if (info.country) {
            countries.push(info.country);
          }
          if (info.city) {
            cities.push(info.city);
          }
        }
        callback();
      }, 100);
    }, 30);

    q.push(cardAddresses);

    await q.drain();