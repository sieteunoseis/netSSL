function convertToJsonString(multilineText) {
  // Replace all newlines with the escape sequence \n
  return multilineText.replace(/\r?\n/g, '\\n');
}

// Example usage
const multilineCert = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCflMnMqm13m3yY
Jt7Q2WC16sxKGoauR2a6QTF2dNbJ4D3ZeZEuUlshvDziHs+9PhN1BiCWTscx0W6m
+uVncPhdoUW1903MkhfzqMqUDXZIoD+IrnD6u7JxSDdmqBjYEsosIuvi6gMEvZv3
8NUy/A4lpWmKRUC6HzuQ69xdwiZ8YyrT3zhQ7o8FNmo8GXjtgTFBBJxk21704UZh
JvfrSUzby1hM6RTjzRsGh0Eer7/YeI5BMQ0gYlw0rCCrsFa5VmRWjR/9nqQr26cI
NANZuruEETZY0vV2rGsMYXjALJJVCHAVCJHBFkvse9nlU80SSQB5NvV0mLxS60ax
5afHWGbfAgMBAAECggEADYQ9v38j/ICIAh8wukHfRilYGmK6y6Iymk4RUXY+ByVe
N8BrQqApJedaxNBVSjMq1LurIPAVQSv7Elun+KYB83RIgkwrI8uwCaxfVED7ptUj
7IDSAvrI931la+WLDSoyQ6DFmBe4H7urrUmR1VqyHBAxq0uIWvtwQSspJCvgtKJT
beZTG55KDbSu0n5OztnDPryR4RHZQ8B0gbNCy/xaEAB5uoZ3VpZuZTMPjsu+kB7q
pO83NOXDksozB8tPxXW5sQi/xg4nEb4q3CO6BAKjYVBuUFRdtq6re4ZIOfbFWukG
UA7cs7M5VK8e0un20imdMzGdmN5GeXQvjekeB0rDKQKBgQDKl4Bb+La1Ep4yR4Uo
WIq+IP0oRGpOlQZMgy6TNUjNuar3F6blx1Cl1QjH8XAn3FKsFtILHZbFR7RU6Z1Q
Q+fT7VBetxN2c09qHSARZ/0u0VixXS0X/nKRLbtfB0KdyXB5hxJ7EDtFW1isP4D2
U7puxHcas0Yntn6dxtRdACjePQKBgQDJppdazWKeIg/etZOQH/tJpGVSM1zNhaOH
z4AAwyN/cJgdLyl4nt8yYroRmk2Y0kA6QeXNwRQoQ3MH8TDiLK5iWbiusvhVbuMA
/0AeafxMRhNvUZSF1/LqDFD6fTzQcyI2yveTUkV20mtgGVvGXd+4RPfltXnnOHTq
H9dqw9QnSwKBgCe7YLQo6gRHG3l251mLS+KP67Za/JJezbZxv8+lEpsuP6ZoIBZO
abWsOyWjZ0CaCCix7Q27Bte4AVjp3C1is/OvRiTdONbxNHD2N1TSlSf6bK+UO4TK
JUPtuSKg9OKnIATlha1W+JjYmmJlrfAhaZ3RsB4vbKHbO6fL19hJcLptAoGALoQ9
efbS/wOAgbGFPsQB5bUEoneyur5PQO7+6i4ZrDY/AMx2VprfhfH8Vj8wE0a9BjNZ
XaNikP8uM/DRg/smpw1navViD+MqfnpjQiDU0IuBxDYfetib8p2wuHfXZYaJp/Ye
Ml/SIlzb5Ck1YIcbKpjOTrEUU+BUKAX8XWabNA0CgYEAmH2QIShhQvzhBkS4l4MC
MXYPAx/W9N0KzGZXBJwygG723Wn0DoybQ/sNE3JrNKi9llSMgBvFV2di0PtcFg5n
6iVf2f6jz8l8CMVBh2WpnhLuvLKrCLq2mAfox3SHjX++mXiiQ/KqYAIE//2rsOYy
7guHU1EWjAtoH7K5ubJyAjU=
-----END PRIVATE KEY-----`;

const singleLineCert = convertToJsonString(multilineCert);
console.log(singleLineCert);