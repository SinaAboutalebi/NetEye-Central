// Packages ===========================================================================
const express = require("express");
const axios = require("axios");
const moment = require("moment");
const app = express();
require("dotenv").config();
//Variables ===========================================================================

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "http://localhost:9090";
const PORT = process.env.PORT || 5000;
const promql = process.env.PROMQL || "probe_http_status_code";

//Functions ===========================================================================

// Helper function to query Prometheus
const queryPrometheus = async (query, startTime, endTime) => {
  try {
    const params = {
      query: query,
      start: startTime,
      end: endTime,
      step: "60s",
    };

    const auth = {
      username: process.env.PROMETHEUS_USER,
      password: process.env.PROMETHEUS_PASSWORD,
    };

    const response = await axios.get(`${PROMETHEUS_URL}/api/v1/query_range`, {
      params,
      auth,
    });
    return response.data;
  } catch (error) {
    console.error("Error querying Prometheus:", error);
    return null;
  }
};

// Helper function to validate the date and time format
const isValidDate = (date) => moment(date, "YYYY-MM-DD", true).isValid();
const isValidTime = (time) => moment(time, "HH:mm", true).isValid();

// Helper function to transform data
function transformHttpStatusData(prometheusResult) {
  const output = {};

  prometheusResult.forEach((item) => {
    // Extract a short, friendly name from the instance URL
    const url = item.metric.instance || "unknown";
    let shortName = url
      .replace(/^https?:\/\//, "") // remove http/https
      .replace(/^www\./, "") // remove leading www
      .split(".")[0]; // take first part (e.g. playstation.com -> playstation)

    // Map values into fault array
    const series = item.values.map(([timestamp, status]) => {
      const code = parseInt(status, 10);
      return code === 200 || code === 301 || code === 302 ? 0 : 1;
    });

    output[shortName] = series;
  });

  return output;
}

// Endpoint ===========================================================================
app.get("/http_monitoring", async (req, res) => {
  const popsite = req.query.popsite;
  const date = req.query.date; // Optional parameter
  const time = req.query.time; // Optional parameter

  if (!popsite) {
    return res.status(400).json({ error: "Popsite is required" });
  }

  // Validate the date and time if provided
  if (date && !isValidDate(date)) {
    return res
      .status(400)
      .json({ error: "Invalid date format. Expected format: YYYY-MM-DD" });
  }

  if (time && !isValidTime(time)) {
    return res
      .status(400)
      .json({ error: "Invalid time format. Expected format: HH:mm (24-hour)" });
  }

  // Convert date and time to a timestamp range if provided
  let startDatetime, endDatetime;

  if (date && time) {
    try {
      const datetimeStr = `${date} ${time}`;
      startDatetime = moment(datetimeStr, "YYYY-MM-DD HH:mm");
      endDatetime = moment(startDatetime).add(6, "hours");
    } catch (error) {
      return res.status(400).json({ error: "Invalid date or time format" });
    }
  } else {
    // Default to last 6 hours if no date/time is provided
    endDatetime = moment.utc();
    startDatetime = moment.utc().subtract(6, "hours");
  }

  // Convert moment objects to Unix timestamps
  const startTimestamp = startDatetime.unix();
  const endTimestamp = endDatetime.unix();

  // Prometheus query for the specified popsite
  const query = `${promql}` + `{popsite="${popsite}"}`;

  // Query Prometheus
  const prometheusData = await queryPrometheus(
    query,
    startTimestamp,
    endTimestamp
  );

  if (!prometheusData || prometheusData.data.result.length === 0) {
    return res
      .status(404)
      .json({ error: `Popsite '${popsite}' not found in Prometheus data` });
  }

  // Process the Prometheus data
  const result = transformHttpStatusData(prometheusData.data.result);

  return res.json(result);
});

//Server ===========================================================================
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
