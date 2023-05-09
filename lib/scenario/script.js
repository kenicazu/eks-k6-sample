import http from "k6/http";
import { check } from "k6";

export const options = {
  stages: [
    { target: 100, duration: "3m" },
    { target: 0, duration: "3m" },
  ],
};

export default function () {
  const result = http.get("<URL>");
  check(result, {
    "http response status code is 200": result.status === 200,
  });
}
