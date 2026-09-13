#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace circuit::protocol {

struct Request {
    std::string type;
    std::string requestId;
    std::optional<std::string> kind;
    std::optional<std::uint64_t> componentId;
    std::optional<std::string> port;
    std::optional<std::uint64_t> sourceComponentId;
    std::optional<std::string> sourcePort;
    std::optional<std::uint64_t> targetComponentId;
    std::optional<std::string> targetPort;
    std::optional<std::string> value;
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
