`timescale 1ns/1ps
module counter(input logic clk, input logic reset, output logic [3:0] count);
  always_ff @(posedge clk)
    if (reset) count <= 4'd0;
    else count <= count + 4'd1;
endmodule
