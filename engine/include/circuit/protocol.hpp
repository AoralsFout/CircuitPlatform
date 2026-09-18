#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace circuit::protocol {

/** 协议里的一份位区间声明；`msb >= lsb`。 */
struct BitRangeSpec {
    std::uint64_t msb;
    std::uint64_t lsb;
};

/**
 * 协议里的一份端口声明。形状在这一层确认；位宽与位区间是否自洽由 Circuit 的领域规则判定——
 * 协议层只负责把 JSON 翻成类型，不重复领域校验。
 */
struct PortSpec {
    std::string name;
    std::string direction;
    std::uint64_t width;
    std::optional<BitRangeSpec> bitRange;
};

/**
 * `ports` 字段的三态：请求里没有这个字段、有且形状合法、有但形状不合法。
 *
 * 三态必须分开，因为「省略端口清单」在 `add_component` 上是「引擎回退到内置定义」的意思，
 * 而形状不合法是一次应当被拒绝的请求，两者不能都退化成空清单。
 */
struct PortListField {
    /** 请求里是否出现了 `ports` 字段。 */
    bool present{false};
    /** 字段形状是否合法；`present` 为假时无意义。 */
    bool wellFormed{true};
    std::vector<PortSpec> ports;
};

struct Request {
    std::string type;
    std::string requestId;
    std::optional<std::string> kind;
    std::optional<std::uint64_t> componentId;
    std::optional<std::uint64_t> connectionId;
    std::optional<std::string> port;
    std::optional<std::uint64_t> sourceComponentId;
    std::optional<std::string> sourcePort;
    std::optional<std::uint64_t> targetComponentId;
    std::optional<std::string> targetPort;
    std::optional<std::string> value;
    PortListField ports;
};

/**
 * 解析当前 JSON Lines 协议支持的请求字段。
 * @param json 一行完整的 JSON 请求。
 * @return 至少包含 type 和 requestId 时返回请求，否则返回空值。
 */
[[nodiscard]] std::optional<Request> parseRequest(std::string_view json);

/**
 * 转义 JSON 字符串中的特殊字符。
 * @param value 要转义的字符串。
 * @return 可以安全嵌入 JSON 字符串字面量的内容。
 */
[[nodiscard]] std::string escapeJson(std::string_view value);

/**
 * 创建统一格式的协议错误响应。
 * @param requestId 关联原请求的身份。
 * @param code 机器可读的错误代码。
 * @param message 面向开发者的错误信息。
 * @return 一行 JSON 错误响应。
 */
[[nodiscard]] std::string errorResponse(
    std::string_view requestId, std::string_view code, std::string_view message);

}  // namespace circuit::protocol
