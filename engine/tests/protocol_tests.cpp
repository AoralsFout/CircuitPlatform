#include "circuit/protocol.hpp"

#include <cassert>

int main() {
    const auto request = circuit::protocol::parseRequest(
        R"({"type":"add_connection","requestId":"req-7","sourceComponentId":12,"sourcePort":"out","targetComponentId":21,"targetPort":"in1"})");

    assert(request.has_value());
    assert(request->type == "add_connection");
    assert(request->requestId == "req-7");
    assert(request->sourceComponentId == 12);
    assert(request->sourcePort == "out");
    assert(request->targetComponentId == 21);
    assert(request->targetPort == "in1");

    const auto signalRequest = circuit::protocol::parseRequest(
        R"({"type":"set_input","requestId":"req-8","componentId":3,"value":"X"})");
    assert(signalRequest.has_value());
    assert(signalRequest->value == "X");

    const auto error = circuit::protocol::errorResponse("req-9", "bad_request", "测试错误");
    assert(error.find("\"requestId\":\"req-9\"") != std::string::npos);
    assert(error.find("测试错误") != std::string::npos);
    return 0;
}
